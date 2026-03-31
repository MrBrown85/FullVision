/* tq-panel-manager.js — Free-floating draggable & resizable panel system
   Converts the Term Questionnaire grid into independently positionable windows.
   Persists layout per-course via getReportConfig / saveReportConfig.
   Panels snap to a 3-column grid (or 2-col / full-width when resized). */
window.TqPanelManager = (function() {
  'use strict';

  var _cid = null;
  var _zCounter = 100;
  var _saveTimer = null;
  var _drag = null;   // active drag state
  var _resize = null; // active resize state
  var _ac = null;     // AbortController for cleanup

  var DRAG_THRESHOLD = 4;
  var SAVE_DEBOUNCE = 500;
  var SNAP_THRESHOLD = 24;       // px — how close before snapping
  var COL_GAP = 12;              // matches CSS gap
  var HANDLE_DIRS = ['n','s','e','w','nw','ne','sw','se'];

  // Min dimensions per panel type
  var MIN_DIMS = {
    'learning-dispositions': { w: 300, h: 200 },
    'relational-identity':   { w: 300, h: 200 },
    'quick-profile':         { w: 300, h: 250 },
    'academic-snapshot':     { w: 280, h: 200 },
    'self-reflections':      { w: 250, h: 100 },
    'observations':          { w: 280, h: 150 },
    'narrative-comment':     { w: 300, h: 250 },
  };
  var DEFAULT_MIN = { w: 200, h: 100 };

  /* ── Snap grid ─────────────────────────────────────────────── */

  function _getSnapColumns(wrapW) {
    var usable = wrapW - COL_GAP * 2;  // 3 cols → 2 gaps
    var colW = usable / 3;
    // Snap X positions: left edge of each column
    var xs = [
      0,
      colW + COL_GAP,
      (colW + COL_GAP) * 2,
    ];
    // Snap widths: 1-col, 2-col, 3-col
    var ws = [
      colW,
      colW * 2 + COL_GAP,
      wrapW,
    ];
    return { xs: xs, ws: ws, colW: colW };
  }

  function _snapX(x, wrapW) {
    var cols = _getSnapColumns(wrapW);
    for (var i = 0; i < cols.xs.length; i++) {
      if (Math.abs(x - cols.xs[i]) < SNAP_THRESHOLD) return cols.xs[i];
    }
    return x;
  }

  function _snapW(w, wrapW) {
    var cols = _getSnapColumns(wrapW);
    for (var i = 0; i < cols.ws.length; i++) {
      if (Math.abs(w - cols.ws[i]) < SNAP_THRESHOLD) return cols.ws[i];
    }
    return w;
  }

  /* ── Layout persistence ────────────────────────────────────── */

  function _loadLayout(cid) {
    try {
      var cfg = getReportConfig(cid);
      return (cfg && cfg.panelLayout) ? cfg.panelLayout : null;
    } catch (e) {
      console.error('Panel layout load failed:', e);
      return null;
    }
  }

  function _saveLayout(cid) {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function() {
      try {
        var wrap = document.querySelector('.tq-wrap.floating');
        if (!wrap) return;
        var layout = {};
        wrap.querySelectorAll('[data-panel-id]').forEach(function(panel) {
          layout[panel.dataset.panelId] = {
            x: parseFloat(panel.style.left) || 0,
            y: parseFloat(panel.style.top) || 0,
            w: parseFloat(panel.style.width) || panel.offsetWidth,
            h: parseFloat(panel.style.height) || panel.offsetHeight,
          };
        });
        var cfg = getReportConfig(cid) || {};
        cfg.panelLayout = layout;
        saveReportConfig(cid, cfg);
      } catch (e) {
        console.error('Panel layout save failed:', e);
      }
    }, SAVE_DEBOUNCE);
  }

  /* ── Z-index management ────────────────────────────────────── */

  function _bringToFront(panel) {
    if (_zCounter > 10000) _renormalizeZ();
    _zCounter++;
    panel.style.zIndex = _zCounter;
  }

  function _renormalizeZ() {
    var wrap = document.querySelector('.tq-wrap.floating');
    if (!wrap) return;
    var panels = Array.from(wrap.querySelectorAll('[data-panel-id]'));
    panels.sort(function(a, b) { return (parseInt(a.style.zIndex)||0) - (parseInt(b.style.zIndex)||0); });
    panels.forEach(function(p, i) { p.style.zIndex = 100 + i; });
    _zCounter = 100 + panels.length;
  }

  /* ── Resize handles ────────────────────────────────────────── */

  function _injectHandles(panel) {
    if (panel.querySelector('.tq-resize-handle')) return;
    HANDLE_DIRS.forEach(function(dir) {
      var h = document.createElement('div');
      h.className = 'tq-resize-handle ' + dir;
      h.dataset.dir = dir;
      panel.appendChild(h);
    });
  }

  /* ── Drag logic ────────────────────────────────────────────── */

  function _onPointerDown(e) {
    var title = e.target.closest('.tq-panel-title');
    if (!title) return;
    if (e.target.closest('button, input, select, a')) return;
    var panel = title.closest('[data-panel-id]');
    if (!panel) return;

    e.preventDefault();
    _bringToFront(panel);

    _drag = {
      panel: panel,
      startX: e.clientX,
      startY: e.clientY,
      origLeft: parseFloat(panel.style.left) || 0,
      origTop: parseFloat(panel.style.top) || 0,
      started: false,
      pointerId: e.pointerId,
    };
    title.setPointerCapture(e.pointerId);
  }

  function _onPointerMoveDrag(e) {
    if (!_drag || e.pointerId !== _drag.pointerId) return;
    var dx = e.clientX - _drag.startX;
    var dy = e.clientY - _drag.startY;

    if (!_drag.started) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      _drag.started = true;
      _drag.panel.classList.add('dragging');
    }

    var newLeft = _drag.origLeft + dx;
    var newTop = _drag.origTop + dy;

    // Constrain to wrap bounds
    var wrap = _drag.panel.parentElement;
    if (wrap && wrap.classList.contains('floating')) wrap = wrap; // direct child
    else wrap = _drag.panel.closest('.tq-wrap.floating');
    if (wrap) {
      var maxX = wrap.clientWidth - _drag.panel.offsetWidth;
      var maxY = wrap.clientHeight - _drag.panel.offsetHeight;
      newLeft = Math.max(0, Math.min(newLeft, maxX));
      newTop = Math.max(0, Math.min(newTop, maxY));
    }

    _drag.panel.style.left = newLeft + 'px';
    _drag.panel.style.top = newTop + 'px';
  }

  function _onPointerUpDrag(e) {
    if (!_drag || e.pointerId !== _drag.pointerId) return;
    _drag.panel.classList.remove('dragging');

    if (_drag.started) {
      // Snap to column grid
      var wrap = _drag.panel.closest('.tq-wrap.floating');
      if (wrap) {
        var wrapW = wrap.clientWidth;
        var curLeft = parseFloat(_drag.panel.style.left) || 0;
        var snappedX = _snapX(curLeft, wrapW);
        _drag.panel.style.left = snappedX + 'px';
      }
      _saveLayout(_cid);
    }
    _drag = null;
  }

  /* ── Resize logic ──────────────────────────────────────────── */

  function _onResizeDown(e) {
    var handle = e.target.closest('.tq-resize-handle');
    if (!handle) return;
    var panel = handle.closest('[data-panel-id]');
    if (!panel) return;

    e.preventDefault();
    e.stopPropagation();
    _bringToFront(panel);

    var rect = panel.getBoundingClientRect();
    var wrap = panel.closest('.tq-wrap.floating');
    var pid = panel.dataset.panelId;
    var mins = MIN_DIMS[pid] || DEFAULT_MIN;

    _resize = {
      panel: panel,
      dir: handle.dataset.dir,
      startX: e.clientX,
      startY: e.clientY,
      origLeft: parseFloat(panel.style.left) || 0,
      origTop: parseFloat(panel.style.top) || 0,
      origW: rect.width,
      origH: rect.height,
      minW: mins.w,
      minH: mins.h,
      wrapW: wrap ? wrap.clientWidth : rect.width + 200,
      wrapH: wrap ? wrap.clientHeight : rect.height + 200,
      pointerId: e.pointerId,
    };
    handle.setPointerCapture(e.pointerId);
  }

  function _onResizeMove(e) {
    if (!_resize || e.pointerId !== _resize.pointerId) return;
    var r = _resize;
    var dx = e.clientX - r.startX;
    var dy = e.clientY - r.startY;
    var dir = r.dir;

    var newL = r.origLeft, newT = r.origTop, newW = r.origW, newH = r.origH;

    // East
    if (dir.indexOf('e') >= 0) {
      newW = Math.max(r.minW, r.origW + dx);
      newW = Math.min(newW, r.wrapW - r.origLeft);
    }
    // West
    if (dir.indexOf('w') >= 0) {
      var wDx = Math.min(dx, r.origW - r.minW);
      newL = Math.max(0, r.origLeft + wDx);
      newW = Math.max(r.minW, r.origW - (newL - r.origLeft));
    }
    // South
    if (dir === 's' || dir === 'se' || dir === 'sw') {
      newH = Math.max(r.minH, r.origH + dy);
      newH = Math.min(newH, r.wrapH - r.origTop);
    }
    // North
    if (dir === 'n' || dir === 'ne' || dir === 'nw') {
      var nDy = Math.min(dy, r.origH - r.minH);
      newT = Math.max(0, r.origTop + nDy);
      newH = Math.max(r.minH, r.origH - (newT - r.origTop));
    }

    r.panel.style.left = newL + 'px';
    r.panel.style.top = newT + 'px';
    r.panel.style.width = newW + 'px';
    r.panel.style.height = newH + 'px';
  }

  function _onResizeUp(e) {
    if (!_resize || e.pointerId !== _resize.pointerId) return;

    // Snap width to column grid
    var wrap = _resize.panel.closest('.tq-wrap.floating');
    if (wrap) {
      var wrapW = wrap.clientWidth;
      var curW = parseFloat(_resize.panel.style.width) || _resize.panel.offsetWidth;
      var curL = parseFloat(_resize.panel.style.left) || 0;
      var snappedW = _snapW(curW, wrapW);
      _resize.panel.style.width = snappedW + 'px';
      // Also snap left edge
      var snappedX = _snapX(curL, wrapW);
      _resize.panel.style.left = snappedX + 'px';
    }

    _resize = null;
    _saveLayout(_cid);
  }

  /* ── Init / Destroy ────────────────────────────────────────── */

  function init(cid) {
    // Clean up previous session
    destroy();

    _cid = cid;
    var wrap = document.querySelector('.tq-wrap');
    if (!wrap) return;

    var panels = wrap.querySelectorAll('[data-panel-id]');
    if (panels.length === 0) return;

    var saved = _loadLayout(cid);

    // Capture default positions from grid before switching to floating
    var defaults = {};
    var wrapRect = wrap.getBoundingClientRect();
    panels.forEach(function(p) {
      var r = p.getBoundingClientRect();
      defaults[p.dataset.panelId] = {
        x: r.left - wrapRect.left,
        y: r.top - wrapRect.top,
        w: r.width,
        h: r.height,
      };
    });

    // Switch to floating mode
    wrap.classList.add('floating');

    // Apply positions — snap defaults to column grid
    var wrapW = wrap.clientWidth;
    panels.forEach(function(panel) {
      var pid = panel.dataset.panelId;
      var pos = (saved && saved[pid]) ? saved[pid] : defaults[pid];
      if (!pos) return;

      // Snap default positions to column grid (saved positions are already snapped)
      var x = pos.x;
      var w = pos.w;
      if (!saved || !saved[pid]) {
        x = _snapX(x, wrapW);
        w = _snapW(w, wrapW);
      }

      panel.style.left = x + 'px';
      panel.style.top = pos.y + 'px';
      panel.style.width = w + 'px';
      panel.style.height = pos.h + 'px';
      _injectHandles(panel);
    });

    // Pin header & footer above panels
    var header = wrap.querySelector('.student-header-top');
    var footer = wrap.querySelector('.tq-nav-footer');
    if (header) header.style.zIndex = '200';
    if (footer) footer.style.zIndex = '200';

    // Attach listeners
    _ac = new AbortController();
    var sig = { signal: _ac.signal };

    wrap.addEventListener('pointerdown', function(e) {
      if (e.target.closest('.tq-resize-handle')) {
        _onResizeDown(e);
      } else {
        var panel = e.target.closest('[data-panel-id]');
        if (panel) _bringToFront(panel);
        _onPointerDown(e);
      }
    }, sig);

    wrap.addEventListener('pointermove', function(e) {
      if (_drag) _onPointerMoveDrag(e);
      if (_resize) _onResizeMove(e);
    }, sig);

    wrap.addEventListener('pointerup', function(e) {
      if (_drag) _onPointerUpDrag(e);
      if (_resize) _onResizeUp(e);
    }, sig);

    wrap.addEventListener('pointercancel', function(e) {
      if (_drag) { _drag.panel.classList.remove('dragging'); _drag = null; }
      if (_resize) { _resize = null; }
    }, sig);
  }

  function destroy() {
    if (_ac) { _ac.abort(); _ac = null; }
    clearTimeout(_saveTimer);
    _drag = null;
    _resize = null;
    _cid = null;
  }

  function resetLayout(cid) {
    try {
      var cfg = getReportConfig(cid) || {};
      delete cfg.panelLayout;
      saveReportConfig(cid, cfg);
    } catch (e) {
      console.error('Panel layout reset failed:', e);
    }
  }

  return {
    init: init,
    destroy: destroy,
    resetLayout: resetLayout,
  };
})();
