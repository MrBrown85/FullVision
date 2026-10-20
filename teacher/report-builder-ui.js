/* report-builder-ui.js — Report builder UI helpers */
window.ReportBuilderUI = (function () {
  'use strict';

  var DEFAULT_BLOCKS = [
    { id: 'header', label: 'Header', enabled: true, locked: true },
    { id: 'academic-summary', label: 'Academic Summary', enabled: true, locked: false },
    { id: 'teacher-narrative', label: 'Teacher Comment', enabled: true, locked: false },
    { id: 'section-chart', label: 'Section Proficiency Chart', enabled: false, locked: false },
    { id: 'grade-table', label: 'Assignment Grades', enabled: false, locked: false },
    { id: 'score-distribution', label: 'Score Distribution', enabled: false, locked: false },
    { id: 'section-outcomes', label: 'Learning Outcomes', enabled: false, locked: false },
    { id: 'core-competencies', label: 'Core Competencies', enabled: false, locked: false },
    { id: 'learner-dimensions', label: 'Disposition Dimensions', enabled: false, locked: false },
    { id: 'student-reflection-learning', label: 'Student Reflection: My Learning', enabled: false, locked: false },
    { id: 'student-reflection-habits', label: 'Student Reflection: My Habits', enabled: false, locked: false },
    { id: 'observations', label: 'Observations & Evidence', enabled: false, locked: false },
    { id: 'next-steps', label: 'Growth & Next Steps', enabled: false, locked: false },
    { id: 'legend', label: 'Proficiency Legend', enabled: false, locked: false },
    { id: 'parent-response', label: 'Parent / Guardian Response', enabled: false, locked: false },
  ];

  var REPORT_PRESETS = {
    brief: ['header', 'academic-summary', 'teacher-narrative'],
    standard: ['header', 'academic-summary', 'teacher-narrative', 'section-chart', 'learner-dimensions', 'next-steps'],
    detailed: [
      'header',
      'academic-summary',
      'teacher-narrative',
      'section-chart',
      'score-distribution',
      'grade-table',
      'section-outcomes',
      'core-competencies',
      'learner-dimensions',
      'student-reflection-learning',
      'student-reflection-habits',
      'observations',
      'next-steps',
      'legend',
      'parent-response',
    ],
  };

  var _dragAbort = null;

  function getReportConfigWrapped(cid) {
    var parsed = typeof getReportConfig === 'function' ? getReportConfig(cid) : {};
    if (parsed && parsed.blocks) {
      var validIds = new Set(
        DEFAULT_BLOCKS.map(function (b) {
          return b.id;
        }),
      );
      parsed.blocks = parsed.blocks.filter(function (b) {
        return validIds.has(b.id);
      });
      parsed.blocks.forEach(function (b) {
        var db = DEFAULT_BLOCKS.find(function (d) {
          return d.id === b.id;
        });
        if (db) b.label = db.label;
      });
      DEFAULT_BLOCKS.forEach(function (db) {
        if (
          !parsed.blocks.find(function (b) {
            return b.id === db.id;
          })
        ) {
          parsed.blocks.push({ id: db.id, label: db.label, enabled: db.enabled, locked: db.locked });
        }
      });
      return parsed;
    }

    var blocks = DEFAULT_BLOCKS.map(function (b) {
      return { id: b.id, label: b.label, enabled: b.enabled, locked: b.locked };
    });
    var std = REPORT_PRESETS.standard;
    blocks.forEach(function (b) {
      b.enabled = std.includes(b.id);
    });
    var ordered = [];
    std.forEach(function (id) {
      var block = blocks.find(function (x) {
        return x.id === id;
      });
      if (block) ordered.push(block);
    });
    blocks.forEach(function (b) {
      if (!std.includes(b.id)) ordered.push(b);
    });
    return { preset: 'standard', blocks: ordered };
  }

  function renderLayout(reportConfig) {
    // "standard" is the Report Card form (report-sheets.js); its stored id
    // stays so saved layouts keep working.
    var labels = { brief: 'Brief', standard: 'Report Card', detailed: 'Detailed' };
    var presetBtns = ['brief', 'standard', 'detailed']
      .map(function (p) {
        return (
          '<button class="rb-preset-btn' +
          (reportConfig.preset === p ? ' active' : '') +
          '" data-preset="' +
          p +
          '" data-action="rbApplyPreset">' +
          labels[p] +
          '</button>'
        );
      })
      .join('');

    return (
      '<div class="rb-layout">' +
      '<aside class="rb-panel no-print" id="rb-panel">' +
      '<div class="rb-panel-header"><div class="rb-panel-title">Report Builder</div></div>' +
      '<div class="rb-presets">' +
      presetBtns +
      '</div>' +
      '<div class="rb-blocks" id="rb-blocks"></div>' +
      '</aside>' +
      '<div class="rb-preview-wrap"><div class="rb-edit-banner" id="rb-edit-banner" hidden><b>Editing the layout.</b> Every student\u2019s report uses this form. Changes save as you make them; press Done when the form is right.</div>' +
      '<div class="rb-preview" id="rb-preview"></div></div>' +
      '</div>'
    );
  }

  function usesSheets(reportConfig) {
    return !!reportConfig && reportConfig.preset === 'standard' && typeof ReportSheets !== 'undefined';
  }

  /* The Report Card is one form for the class. In Review the rail lists its
     blocks; in Edit Layout each block gets its controls: move up or down,
     to the other side, remove, and the few options a block has. */
  function _kindText(it) {
    if (it.pair) return 'Fixed · side by side';
    if (it.kind === 'flow') return 'Flows';
    return it.pinned ? 'Fixed · bottom of the back' : 'Fixed';
  }

  function _itemLabel(it) {
    if (it.pair)
      return it.pair
        .map(function (q) {
          return q.label;
        })
        .join(' + ');
    return it.label;
  }

  function _editControls(it, side, idx, list) {
    var count = list.length;
    if (it.locked) return '<span class="rb-form-kind">' + LINE_ICONS.lock + ' first on the front</span>';
    var b = function (action, extra, title, text) {
      return (
        '<button type="button" class="rb-form-btn" data-action="' +
        action +
        '" data-side="' +
        side +
        '" data-idx="' +
        idx +
        '"' +
        (extra || '') +
        ' title="' +
        title +
        '" aria-label="' +
        title +
        '">' +
        text +
        '</button>'
      );
    };
    var html = '<span class="rb-form-controls">';
    if (!it.pinned) {
      html += b(
        'rbFormMove',
        ' data-dir="-1"' + (idx <= (side === 'front' ? 1 : 0) ? ' disabled' : ''),
        'Move up',
        '\u2191',
      );
      html += b(
        'rbFormMove',
        ' data-dir="1"' + (idx >= count - 1 || (list[idx + 1] && list[idx + 1].pinned) ? ' disabled' : ''),
        'Move down',
        '\u2193',
      );
      html += b(
        'rbFormSide',
        '',
        side === 'front' ? 'Move to the back' : 'Move to the front',
        side === 'front' ? 'Back' : 'Front',
      );
      if (it.pair) html += b('rbFormUnpair', '', 'Put these blocks one above the other', 'Unpair');
      else if (ReportSheets.canPair(it, list[idx + 1]))
        html += b('rbFormPair', '', 'Put this block beside the next one', 'Pair');
    }
    html += b('rbFormRemove', '', 'Remove from the form', '\u00D7');
    html += '</span>';
    return html;
  }

  function _itemOptions(it) {
    if (it.pair) return '';
    var html = '';
    if (it.block === 'teacher-narrative') {
      html +=
        '<label class="rb-form-opt">Room on the front <input type="number" class="rb-form-num" data-action="rbFormRoom" min="1" max="20" value="' +
        (it.room ? it.room.lines : 8) +
        '" aria-label="Lines kept for the comment on the front"> lines</label>';
    }
    if (it.kind === 'flow') {
      html +=
        '<label class="rb-form-opt">When empty <select class="rb-form-sel" data-action="rbFormEmpty" data-block="' +
        it.block +
        '" aria-label="When this block is empty"><option value="omit"' +
        (it.whenEmpty !== 'box' ? ' selected' : '') +
        '>Leave it out</option><option value="box"' +
        (it.whenEmpty === 'box' ? ' selected' : '') +
        '>Print the box with lines</option></select></label>';
    }
    if (ReportSheets.BLOCKS[it.block] && ReportSheets.BLOCKS[it.block].pinnable) {
      html +=
        '<label class="rb-form-opt rb-form-check"><input type="checkbox" data-action="rbFormPin" data-block="' +
        it.block +
        '"' +
        (it.pinned ? ' checked' : '') +
        '> Pinned to the bottom of the back</label>';
    }
    return html ? '<div class="rb-form-opts">' + html + '</div>' : '';
  }

  function _itemKey(it) {
    return it.pair
      ? it.pair
          .map(function (q) {
            return q.block;
          })
          .join('+')
      : it.block;
  }

  function _sideList(form, side, editing) {
    var list = side === 'back' ? form.back : form.front;
    var html = '<div class="rb-form-side">' + (side === 'back' ? 'Back' : 'Front') + '</div>';
    html += '<div class="rb-form-list" data-side="' + side + '">';
    if (!list.length)
      html += '<div class="rb-form-empty">Nothing on this side yet. Move a block here or add one.</div>';
    list.forEach(function (it, idx) {
      var draggable = editing && !it.locked && !it.pinned;
      html +=
        '<div class="rb-block rb-form-block' +
        (editing ? ' editing' : '') +
        (it.locked ? ' locked' : '') +
        (it.pinned ? ' pinned' : '') +
        '" data-side="' +
        side +
        '" data-idx="' +
        idx +
        '" data-key="' +
        esc(_itemKey(it)) +
        '"><div class="rb-form-row">' +
        (draggable
          ? '<button type="button" class="rb-form-grip" data-action="rbFormGrip" data-drag="grip" data-side="' +
            side +
            '" data-idx="' +
            idx +
            '" aria-label="Move ' +
            esc(_itemLabel(it)) +
            ': arrow keys move it up, down, to the front or the back" title="Drag, or use the arrow keys">\u283F</button>'
          : '') +
        '<span class="rb-form-label">' +
        esc(_itemLabel(it)) +
        '</span>' +
        (editing ? _editControls(it, side, idx, list) : '<span class="rb-form-kind">' + _kindText(it) + '</span>') +
        '</div>' +
        (editing ? _itemOptions(it) : '') +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  /* extras: { previewWith: { longest, typical, shortest } of { sid, name }, pick } */
  function renderFormBlocks(form, editing, extras) {
    extras = extras || {};
    var html = '';
    if (editing) {
      html +=
        '<div class="rb-form-note rb-form-editing">Every student\u2019s report uses this form. Fixed blocks print the same for everyone; flowing blocks grow with each student and push what follows down the sheet.</div>';
      if (extras.previewWith) {
        var pw = extras.previewWith;
        html +=
          '<div class="rb-form-whole"><span class="rb-form-whole-k">Preview With</span><span class="seg seg-sm" role="radiogroup" aria-label="Preview with">';
        ['longest', 'typical', 'shortest'].forEach(function (k) {
          if (!pw[k]) return;
          var on = extras.pick === k;
          html +=
            '<button type="button" class="seg-btn' +
            (on ? ' active' : '') +
            '" data-action="rbFormPreviewWith" data-pick="' +
            k +
            '" role="radio" aria-checked="' +
            on +
            '">' +
            k.charAt(0).toUpperCase() +
            k.slice(1) +
            ' \u00B7 ' +
            esc(pw[k].name.split(' ')[0]) +
            '</button>';
        });
        html +=
          '<button type="button" class="seg-btn' +
          (!extras.pick ? ' active' : '') +
          '" data-action="rbFormPreviewWith" data-pick="" role="radio" aria-checked="' +
          !extras.pick +
          '">Everyone</button></span></div>';
      }
      html +=
        '<div class="rb-form-whole"><span class="rb-form-whole-k">Type Size</span><span class="seg seg-sm" role="radiogroup" aria-label="Type size">' +
        '<button type="button" class="seg-btn' +
        (form.type !== 'compact' ? ' active' : '') +
        '" data-action="rbFormType" data-type="standard" role="radio" aria-checked="' +
        (form.type !== 'compact') +
        '">Standard</button>' +
        '<button type="button" class="seg-btn' +
        (form.type === 'compact' ? ' active' : '') +
        '" data-action="rbFormType" data-type="compact" role="radio" aria-checked="' +
        (form.type === 'compact') +
        '">Compact</button></span><span class="rb-form-kind">applies to every student</span></div>';
    } else {
      html +=
        '<div class="rb-form-note">One form for every student. Fixed blocks print the same for everyone; flowing blocks grow with each student and push what follows down the sheet.</div>';
    }
    html += _sideList(form, 'front', editing);
    html += _sideList(form, 'back', editing);
    if (editing) {
      var avail = ReportSheets.available(form);
      html +=
        '<div class="rb-form-add"><label class="rb-form-opt">Add a Block <select class="rb-form-sel" data-action="rbFormAdd" aria-label="Add a block to the form"><option value="">Choose\u2026</option>';
      avail.forEach(function (id) {
        html += '<option value="' + id + '">' + esc(ReportSheets.BLOCKS[id].label) + '</option>';
      });
      html += '</select></label><span class="rb-form-kind">goes to the front; move it after</span></div>';
      html += '<div class="rb-form-side">Starters</div><div class="rb-form-starters">';
      ReportSheets.starters().forEach(function (st) {
        html +=
          '<button type="button" class="rb-form-starter" data-action="rbFormStarter" data-starter="' +
          st.id +
          '"><b>' +
          esc(st.name) +
          '</b><span>' +
          esc(st.help) +
          '</span></button>';
      });
      html += '</div>';
      var lib = ReportSheets.templates();
      html += '<div class="rb-form-side">Your Library</div>';
      if (lib.length) {
        html += '<div class="rb-form-library">';
        lib.forEach(function (t) {
          html +=
            '<div class="rb-form-template"><button type="button" class="rb-form-apply" data-action="rbFormApplyTemplate" data-id="' +
            esc(t.id) +
            '">' +
            esc(t.name) +
            '</button><button type="button" class="rb-form-btn" data-action="rbFormDeleteTemplate" data-id="' +
            esc(t.id) +
            '" title="Remove from the library" aria-label="Remove ' +
            esc(t.name) +
            ' from the library">\u00D7</button></div>';
        });
        html += '</div>';
      } else {
        html +=
          '<div class="rb-form-empty">Nothing saved yet. A saved form can be applied to any of your classes, on any computer you sign in on.</div>';
      }
      html +=
        '<form class="rb-form-save" data-action="rbFormSaveTemplate"><input type="text" class="rb-form-text" id="rb-template-name" placeholder="Name this form" aria-label="Name for the saved form" maxlength="60"><button type="submit" class="rb-form-reset">Save to Library</button></form>';
      html +=
        '<div class="rb-form-actions"><button type="button" class="rb-form-reset" data-action="rbFormReset">Reset to the Report Card</button></div>';
      html += '<div class="rb-form-live" id="rb-live" aria-live="polite"></div>';
    }
    html += '<div class="rb-form-summary" id="rb-form-summary"></div>';
    return html;
  }

  /* Pointer drag inside one side of the form. The grip picks the block up;
     it drops where the placeholder is. onReorder(side, from, to). */
  var _formDragAbort = null;
  function initFormDrag(root, opts) {
    if (!root) return;
    if (_formDragAbort) _formDragAbort.abort();
    _formDragAbort = new AbortController();
    var signal = _formDragAbort.signal;
    var drag = null;

    root.addEventListener(
      'pointerdown',
      function (e) {
        var grip = e.target.closest('[data-drag="grip"]');
        if (!grip) return;
        var block = grip.closest('.rb-form-block');
        var list = grip.closest('.rb-form-list');
        if (!block || !list) return;
        e.preventDefault();
        grip.setPointerCapture(e.pointerId);
        var rect = block.getBoundingClientRect();
        drag = {
          el: block,
          list: list,
          side: list.dataset.side,
          from: Number(block.dataset.idx),
          offsetY: e.clientY - rect.top,
          placeholder: document.createElement('div'),
        };
        drag.placeholder.className = 'rb-block-placeholder';
        drag.placeholder.style.height = block.offsetHeight + 'px';
        block.classList.add('dragging');
        block.style.position = 'fixed';
        block.style.top = rect.top + 'px';
        block.style.left = rect.left + 'px';
        block.style.width = rect.width + 'px';
        block.style.zIndex = '1000';
        block.style.pointerEvents = 'none';
        list.insertBefore(drag.placeholder, block);
      },
      { signal: signal },
    );

    root.addEventListener(
      'pointermove',
      function (e) {
        if (!drag) return;
        e.preventDefault();
        drag.el.style.top = e.clientY - drag.offsetY + 'px';
        var blocks = Array.from(drag.list.querySelectorAll('.rb-form-block:not(.dragging)'));
        for (var i = 0; i < blocks.length; i++) {
          if (blocks[i].classList.contains('locked')) continue;
          var rect = blocks[i].getBoundingClientRect();
          if (e.clientY < rect.top + rect.height / 2) {
            drag.list.insertBefore(drag.placeholder, blocks[i]);
            return;
          }
        }
        var pinned = drag.list.querySelector('.rb-form-block.pinned:not(.dragging)');
        if (pinned) drag.list.insertBefore(drag.placeholder, pinned);
        else drag.list.appendChild(drag.placeholder);
      },
      { signal: signal },
    );

    function finish() {
      if (!drag) return;
      var items = Array.from(drag.list.children).filter(function (c) {
        return c !== drag.el;
      });
      var to = items.indexOf(drag.placeholder);
      var d = drag;
      drag = null;
      d.el.classList.remove('dragging');
      d.el.style.position = '';
      d.el.style.top = '';
      d.el.style.left = '';
      d.el.style.width = '';
      d.el.style.zIndex = '';
      d.el.style.pointerEvents = '';
      if (d.placeholder.parentNode) d.placeholder.parentNode.removeChild(d.placeholder);
      if (to >= 0 && to !== d.from && opts && typeof opts.onReorder === 'function') opts.onReorder(d.side, d.from, to);
      else if (opts && typeof opts.onCancel === 'function') opts.onCancel();
    }
    root.addEventListener('pointerup', finish, { signal: signal });
    root.addEventListener('pointercancel', finish, { signal: signal });
  }

  function renderBuilderBlocks(reportConfig, editing, extras) {
    if (usesSheets(reportConfig)) return renderFormBlocks(ReportSheets.formFor(reportConfig), !!editing, extras);
    var html = '';
    reportConfig.blocks.forEach(function (block, idx) {
      var enabledClass = block.enabled ? ' enabled' : '';
      var lockedClass = block.locked ? ' locked' : '';
      html +=
        '<div class="rb-block' +
        enabledClass +
        lockedClass +
        '" data-idx="' +
        idx +
        '">' +
        '<span class="rb-drag-grip"' +
        (block.locked ? '' : ' data-drag="grip"') +
        '>' +
        (block.locked ? LINE_ICONS.lock : '\u283F') +
        '</span>' +
        (block.locked
          ? '<span class="rb-block-label">' + esc(block.label) + '</span>'
          : '<label class="rb-block-toggle" data-action="rbToggleBlock" data-blockid="' +
            block.id +
            '"><div class="rb-block-switch"></div></label>' +
            '<span class="rb-block-label">' +
            esc(block.label) +
            '</span>') +
        '</div>';
    });
    return html;
  }

  function toggleBlock(reportConfig, blockId) {
    var block = reportConfig.blocks.find(function (b) {
      return b.id === blockId;
    });
    if (!block || block.locked) return reportConfig;
    block.enabled = !block.enabled;
    reportConfig.preset = 'custom';
    return reportConfig;
  }

  function applyPreset(reportConfig, preset) {
    var order = REPORT_PRESETS[preset];
    if (!order) return reportConfig;
    var ordered = [];
    var remaining = [];
    order.forEach(function (id) {
      var block = reportConfig.blocks.find(function (x) {
        return x.id === id;
      });
      if (block) {
        block.enabled = true;
        ordered.push(block);
      }
    });
    reportConfig.blocks.forEach(function (block) {
      if (!order.includes(block.id)) {
        block.enabled = false;
        remaining.push(block);
      }
    });
    reportConfig.blocks = ordered.concat(remaining);
    reportConfig.preset = preset;
    return reportConfig;
  }

  function updatePresetBtns(reportConfig) {
    document.querySelectorAll('.rb-preset-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.preset === reportConfig.preset);
    });
  }

  function initPointerDrag(container, opts) {
    if (!container) return;
    if (_dragAbort) _dragAbort.abort();
    _dragAbort = new AbortController();
    var signal = _dragAbort.signal;
    var dragEl = null;
    var placeholder = null;
    var offsetY = 0;
    var startIdx = -1;
    var blockHeight = 0;

    container.addEventListener(
      'pointerdown',
      function (e) {
        var grip = e.target.closest('[data-drag="grip"]');
        if (!grip) return;
        var block = grip.closest('.rb-block');
        if (!block) return;
        startIdx = parseInt(block.dataset.idx, 10);
        if (isNaN(startIdx)) return;
        e.preventDefault();
        grip.setPointerCapture(e.pointerId);
        var rect = block.getBoundingClientRect();
        offsetY = e.clientY - rect.top;
        dragEl = block;
        blockHeight = block.offsetHeight + 1;
        placeholder = document.createElement('div');
        placeholder.className = 'rb-block-placeholder';
        placeholder.style.height = blockHeight + 'px';
        block.classList.add('dragging');
        block.style.position = 'fixed';
        block.style.top = rect.top + 'px';
        block.style.left = rect.left + 'px';
        block.style.width = rect.width + 'px';
        block.style.zIndex = '1000';
        block.style.pointerEvents = 'none';
        block.parentNode.insertBefore(placeholder, block);
      },
      { signal: signal },
    );

    container.addEventListener(
      'pointermove',
      function (e) {
        if (!dragEl) return;
        e.preventDefault();
        dragEl.style.top = e.clientY - offsetY + 'px';
        var blocks = Array.from(container.querySelectorAll('.rb-block:not(.dragging)'));
        for (var i = 0; i < blocks.length; i++) {
          var rect = blocks[i].getBoundingClientRect();
          var mid = rect.top + rect.height / 2;
          if (e.clientY < mid) {
            if (blocks[i].classList.contains('locked')) continue;
            container.insertBefore(placeholder, blocks[i]);
            return;
          }
        }
        container.appendChild(placeholder);
      },
      { signal: signal },
    );

    function finishDrag() {
      if (!dragEl) return;
      var allItems = Array.from(container.children).filter(function (c) {
        return c !== dragEl;
      });
      var targetIdx = allItems.indexOf(placeholder);
      dragEl.classList.remove('dragging');
      dragEl.style.position = '';
      dragEl.style.top = '';
      dragEl.style.left = '';
      dragEl.style.width = '';
      dragEl.style.zIndex = '';
      dragEl.style.pointerEvents = '';
      if (placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
      dragEl = null;
      placeholder = null;
      if (targetIdx >= 0 && targetIdx !== startIdx) {
        var insertAt = startIdx < targetIdx ? targetIdx - 1 : targetIdx;
        var finalIdx = Math.max(1, insertAt);
        if (opts && typeof opts.onReorder === 'function') opts.onReorder(startIdx, finalIdx);
      } else if (opts && typeof opts.onCancel === 'function') {
        opts.onCancel();
      }
      startIdx = -1;
    }

    container.addEventListener('pointerup', finishDrag, { signal: signal });
    container.addEventListener('pointercancel', finishDrag, { signal: signal });
  }

  return {
    DEFAULT_BLOCKS: DEFAULT_BLOCKS,
    REPORT_PRESETS: REPORT_PRESETS,
    getReportConfigWrapped: getReportConfigWrapped,
    renderLayout: renderLayout,
    renderBuilderBlocks: renderBuilderBlocks,
    renderFormBlocks: renderFormBlocks,
    initFormDrag: initFormDrag,
    usesSheets: usesSheets,
    toggleBlock: toggleBlock,
    applyPreset: applyPreset,
    updatePresetBtns: updatePresetBtns,
    initPointerDrag: initPointerDrag,
  };
})();
