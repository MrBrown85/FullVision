/* card-widget-editor.js — Long-press edit mode for student card widgets */

window.MCardWidgetEditor = (function() {
  'use strict';

  var MC = window.MComponents;

  function buildEditorHTML() {
    var config = getCardWidgetConfig();
    var html = '<div class="m-wdg-editor">' +
      '<div class="m-wdg-editor-header">' +
        '<div class="m-wdg-editor-title">Customize Card</div>' +
        '<button class="m-wdg-editor-done" data-action="m-dismiss-sheet">Done</button>' +
      '</div>';

    // Enabled widgets
    html += '<div class="m-wdg-editor-section-label">Visible</div>';
    html += '<div class="m-wdg-editor-list" id="m-wdg-enabled-list">';
    config.order.forEach(function(key) {
      var w = WIDGET_REGISTRY.find(function(r) { return r.key === key; });
      if (!w) return;
      var noDrag = key === 'flagStatus';
      html += _editorRow(w, true, noDrag);
    });
    html += '</div>';

    // Disabled widgets
    html += '<div class="m-wdg-editor-section-label">More Widgets</div>';
    html += '<div class="m-wdg-editor-list" id="m-wdg-disabled-list">';
    config.disabled.forEach(function(key) {
      var w = WIDGET_REGISTRY.find(function(r) { return r.key === key; });
      if (!w) return;
      html += _editorRow(w, false, false);
    });
    html += '</div>';

    html += '<button class="m-wdg-editor-reset" data-action="m-wdg-reset">Reset to Defaults</button>';
    html += '</div>';
    return html;
  }

  function _editorRow(widget, enabled, noDrag) {
    return '<div class="m-wdg-editor-row" data-widget="' + widget.key + '" data-enabled="' + enabled + '">' +
      (noDrag ? '<div class="m-wdg-editor-drag-spacer"></div>' : '<div class="m-wdg-editor-drag" data-action="m-wdg-drag">\u2630</div>') +
      '<div class="m-wdg-editor-label">' + widget.label + '</div>' +
      '<button class="m-wdg-editor-toggle' + (enabled ? ' m-wdg-toggle-on' : '') + '" data-action="m-wdg-toggle" data-widget="' + widget.key + '">' +
        '<div class="m-wdg-toggle-knob"></div>' +
      '</button>' +
    '</div>';
  }

  function toggleWidget(key) {
    var config = getCardWidgetConfig();
    var orderIdx = config.order.indexOf(key);
    if (orderIdx >= 0) {
      config.order.splice(orderIdx, 1);
      config.disabled.push(key);
    } else {
      var disIdx = config.disabled.indexOf(key);
      if (disIdx >= 0) config.disabled.splice(disIdx, 1);
      config.order.push(key);
    }
    saveCardWidgetConfig(config);
  }

  function moveWidget(key, toIndex) {
    var config = getCardWidgetConfig();
    var fromIndex = config.order.indexOf(key);
    if (fromIndex < 0) return;
    config.order.splice(fromIndex, 1);
    config.order.splice(toIndex, 0, key);
    saveCardWidgetConfig(config);
  }

  function resetToDefaults() {
    localStorage.removeItem('m-card-widgets');
  }

  var _onUpdate = null;

  function show(onUpdate) {
    MC.presentSheet(buildEditorHTML(), { half: false });
    MC.haptic();
    _onUpdate = onUpdate || null;
    initDragListeners();
  }

  function handleAction(action, el) {
    if (action === 'm-wdg-toggle') {
      var key = el.dataset.widget;
      toggleWidget(key);
      var container = document.getElementById('m-sheet-container');
      var content = container.querySelector('.m-sheet-content');
      if (content) content.innerHTML = buildEditorHTML();
      if (_onUpdate) _onUpdate();
      return true;
    }
    if (action === 'm-wdg-reset') {
      if (el.dataset.confirm !== 'yes') {
        el.textContent = 'Reset card layout?';
        el.dataset.confirm = 'yes';
        el.classList.add('m-wdg-editor-reset-confirm');
        setTimeout(function() {
          el.textContent = 'Reset to Defaults';
          delete el.dataset.confirm;
          el.classList.remove('m-wdg-editor-reset-confirm');
        }, 3000);
        return true;
      }
      resetToDefaults();
      var container = document.getElementById('m-sheet-container');
      var content = container.querySelector('.m-sheet-content');
      if (content) content.innerHTML = buildEditorHTML();
      if (_onUpdate) _onUpdate();
      return true;
    }
    return false;
  }

  function initDragListeners() {
    var container = document.getElementById('m-sheet-container');
    if (!container) return;

    var _dragState = null;

    container.addEventListener('touchstart', function(e) {
      var drag = e.target.closest('[data-action="m-wdg-drag"]');
      if (!drag) return;
      var row = drag.closest('.m-wdg-editor-row');
      if (!row) return;
      e.preventDefault();
      var touch = e.touches[0];
      var rect = row.getBoundingClientRect();
      _dragState = {
        key: row.dataset.widget,
        el: row,
        startY: touch.clientY,
        offsetY: touch.clientY - rect.top,
        rowHeight: rect.height
      };
      row.classList.add('m-wdg-row-dragging');
      MC.haptic();
    }, { passive: false });

    container.addEventListener('touchmove', function(e) {
      if (!_dragState) return;
      e.preventDefault();
      var touch = e.touches[0];
      var dy = touch.clientY - _dragState.startY;
      _dragState.el.style.transform = 'translateY(' + dy + 'px)';
    }, { passive: false });

    container.addEventListener('touchend', function() {
      if (!_dragState) return;
      var el = _dragState.el;
      var dy = parseFloat(el.style.transform.replace('translateY(', '').replace('px)', '')) || 0;
      var slots = Math.round(dy / _dragState.rowHeight);
      el.classList.remove('m-wdg-row-dragging');
      el.style.transform = '';
      if (slots !== 0) {
        var config = getCardWidgetConfig();
        var fromIdx = config.order.indexOf(_dragState.key);
        if (fromIdx >= 0) {
          var toIdx = Math.max(0, Math.min(config.order.length - 1, fromIdx + slots));
          moveWidget(_dragState.key, toIdx);
          var content = document.querySelector('#m-sheet-container .m-sheet-content');
          if (content) content.innerHTML = buildEditorHTML();
          if (_onUpdate) _onUpdate();
        }
      }
      _dragState = null;
    });
  }

  return {
    buildEditorHTML: buildEditorHTML,
    toggleWidget: toggleWidget,
    moveWidget: moveWidget,
    resetToDefaults: resetToDefaults,
    show: show,
    handleAction: handleAction,
    initDragListeners: initDragListeners
  };
})();
