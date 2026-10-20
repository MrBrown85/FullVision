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
      '<div class="rb-preview-wrap"><div class="rb-preview" id="rb-preview"></div></div>' +
      '</div>'
    );
  }

  function usesSheets(reportConfig) {
    return !!reportConfig && reportConfig.preset === 'standard' && typeof ReportSheets !== 'undefined';
  }

  /* The Report Card is one form for the class (report-sheets.js). The rail
     is a setup list a teacher can read in a breath: which form, type size,
     comment room and which optional blocks are on. The form decides where
     everything goes (DECISIONS "Report forms" 8). */
  function _seg(label, ariaLabel, action, dataKey, choices, current) {
    var html =
      '<div class="rb-setup-row"><span class="rb-setup-k">' +
      label +
      '</span><span class="seg seg-sm" role="radiogroup" aria-label="' +
      ariaLabel +
      '">';
    choices.forEach(function (c) {
      var on = c.value === current;
      html +=
        '<button type="button" class="seg-btn' +
        (on ? ' active' : '') +
        '" data-action="' +
        action +
        '" data-' +
        dataKey +
        '="' +
        c.value +
        '" role="radio" aria-checked="' +
        on +
        '">' +
        esc(c.label) +
        '</button>';
    });
    return html + '</span></div>';
  }

  /* fits: { formId: { most, max } } from ReportSheets.sheetsForForms, once known. */
  function renderSetup(form, fits) {
    fits = fits || {};
    var html = '<div class="rb-setup">';
    html += '<div class="rb-setup-k">Form</div><div class="rb-setup-forms" role="radiogroup" aria-label="Form">';
    ReportSheets.starters().forEach(function (st) {
      var on = form.id === st.id;
      html +=
        '<button type="button" class="rb-setup-form' +
        (on ? ' active' : '') +
        '" data-action="rbSetupForm" data-form="' +
        st.id +
        '" role="radio" aria-checked="' +
        on +
        '"><b>' +
        esc(st.name) +
        (fits[st.id] ? '<em class="rb-setup-fit">' + esc(ReportSheets.fitLabel(fits[st.id])) + '</em>' : '') +
        '</b><span>' +
        esc(st.help) +
        '</span></button>';
    });
    html += '</div>';
    html += _seg(
      'Type Size',
      'Type size',
      'rbSetupType',
      'type',
      [
        { value: 'standard', label: 'Standard' },
        { value: 'compact', label: 'Compact' },
      ],
      form.type === 'compact' ? 'compact' : 'standard',
    );
    var room = ReportSheets.roomChoice(form);
    if (room) {
      html += _seg(
        'Comment Room',
        'Comment room',
        'rbSetupRoom',
        'room',
        [
          { value: 'short', label: 'Short' },
          { value: 'standard', label: 'Standard' },
          { value: 'long', label: 'Long' },
        ],
        room,
      );
    }
    html += '<div class="rb-setup-k">Include</div><div class="rb-setup-includes">';
    ReportSheets.includes(form).forEach(function (inc) {
      html +=
        '<label class="rb-setup-check"><input type="checkbox" data-action="rbSetupInclude" data-include="' +
        inc.id +
        '"' +
        (inc.on ? ' checked' : '') +
        '> ' +
        esc(inc.label) +
        '</label>';
    });
    html += '</div>';
    html +=
      '<div class="rb-form-note">One form for every student. The student list shows how many sheets each needs; Fit Map shows the whole class.</div>';
    html += '<div class="rb-form-summary" id="rb-form-summary"></div>';
    return html + '</div>';
  }

  function renderBuilderBlocks(reportConfig, extras) {
    if (usesSheets(reportConfig)) return renderSetup(ReportSheets.formFor(reportConfig), extras && extras.fits);
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
    renderSetup: renderSetup,
    usesSheets: usesSheets,
    toggleBlock: toggleBlock,
    applyPreset: applyPreset,
    updatePresetBtns: updatePresetBtns,
    initPointerDrag: initPointerDrag,
  };
})();
