/* gradebook-chrome.js — the Gradebook grid's chrome: row and column hover, scroll sync,
   sticky Overall column, header height, slanted headers. Moved from teacher/page-gradebook.js on 2026-11-12. */
window.GradebookChrome = (function () {
  'use strict';

  /* ── 4-quadrant grid: row hover sync between Q3 and Q4 ───── */
  function initGridHoverSync() {
    var data = document.getElementById('gb-data');
    var rowheads = document.getElementById('gb-rowheads');
    if (!data || !rowheads) return;
    var rowheadDivs = rowheads.querySelectorAll('.gb-grid-rowhead');
    var dataRows = data.querySelectorAll('tbody tr:not(.gb-stats-row)');

    // Hover Q4 row → highlight Q3 rowhead
    dataRows.forEach(function (tr, i) {
      tr.addEventListener('mouseenter', function () {
        if (rowheadDivs[i]) rowheadDivs[i].classList.add('gb-row-hover');
      });
      tr.addEventListener('mouseleave', function () {
        if (rowheadDivs[i]) rowheadDivs[i].classList.remove('gb-row-hover');
      });
    });

    // Hover Q3 rowhead → highlight Q4 row
    rowheadDivs.forEach(function (div, i) {
      div.addEventListener('mouseenter', function () {
        if (dataRows[i]) dataRows[i].classList.add('gb-row-hover');
      });
      div.addEventListener('mouseleave', function () {
        if (dataRows[i]) dataRows[i].classList.remove('gb-row-hover');
      });
    });

    // Hover a Q4 cell → highlight its column too, header and all, so a
    // score reads against both its student and its assignment.
    data.addEventListener('mouseover', function (e) {
      var td = e.target.closest ? e.target.closest('td') : null;
      var idx = td && data.contains(td) ? td.cellIndex : -1;
      if (idx === _hoveredColIdx) return;
      hideColTooltip();
      if (idx < 0) return;
      _hoveredColIdx = idx;
      showColTooltip(_colHeadAt(idx), idx);
    });
    data.addEventListener('mouseleave', hideColTooltip);
  }

  /* A column's header: the slanted heading (Scores) or the competency code
     under its assessment (Competencies). */
  function _colHeadAt(idx) {
    return document.querySelectorAll('#gb-colheads .gb-grid-colhead, #gb-colheads .gb-grid-tag-header')[idx] || null;
  }

  /* ── 4-quadrant grid scroll sync ─────────────────────────── */
  var _gridScrollHandler = null;
  function initGridScrollSync() {
    // Remove previous listener to prevent stacking
    if (_gridScrollHandler && _gridScrollHandler.el) {
      _gridScrollHandler.el.removeEventListener('scroll', _gridScrollHandler.fn);
      _gridScrollHandler.win.removeEventListener('resize', _gridScrollHandler.resize);
    }
    var data = document.getElementById('gb-data');
    var colheads = document.getElementById('gb-colheads');
    var colheadsInner = colheads && colheads.querySelector('.gb-grid-colheads-inner');
    var rowheads = document.getElementById('gb-rowheads');
    if (!data || !colheads || !rowheads) return;
    // A scroll only moves the headers and the names along: it reads no layout.
    var fn = function () {
      if (colheadsInner) colheadsInner.style.transform = 'translateX(-' + data.scrollLeft + 'px)';
      rowheads.scrollTop = data.scrollTop;
    };
    // The data area's horizontal scrollbar shortens its view; the names
    // get the same room at the bottom so the last rows still line up.
    // Worked out after a draw and when the window is resized, in the frame
    // that lays the page out anyway.
    var pad = 0;
    var waiting = false;
    var fit = function () {
      waiting = false;
      if (!data.isConnected) return;
      var gap = data.scrollHeight - data.clientHeight - (rowheads.scrollHeight - rowheads.clientHeight);
      if (gap && pad + gap >= 0) {
        pad += gap;
        rowheads.style.setProperty('--gb-hscroll', pad + 'px');
        rowheads.scrollTop = data.scrollTop;
      }
    };
    var resize = function () {
      if (waiting) return;
      waiting = true;
      requestAnimationFrame(fit);
    };
    resize();
    var win = data.ownerDocument.defaultView || window;
    win.addEventListener('resize', resize);
    data.addEventListener('scroll', fn, { passive: true });
    // A name that takes the focus (Tab, or ← from a score) scrolls the
    // names' column into view; the scores follow so the rows stay in line.
    rowheads.addEventListener(
      'scroll',
      function () {
        if (Math.abs(rowheads.scrollTop - data.scrollTop) > 1) data.scrollTop = rowheads.scrollTop;
      },
      { passive: true },
    );
    _gridScrollHandler = { el: data, fn: fn, resize: resize, win: win };
  }

  /* Put the data area back at a saved position and line the headers up with
     it now, not on the next scroll event. */
  function restoreGridScroll(pos) {
    var data = document.getElementById('gb-data');
    if (!data) return;
    data.scrollTop = pos.top;
    data.scrollLeft = pos.left;
    if (_gridScrollHandler) _gridScrollHandler.fn();
  }

  /* ── Sticky left positions ─────────────────────────────── */
  function applyStickyLeft() {
    var table = document.querySelector('.gb-table');
    if (!table) return;
    var firstRow = table.querySelector('tbody tr') || table.querySelector('thead tr');
    if (!firstRow) return;
    var nameCell = firstRow.querySelector('.gb-name, .gb-corner');
    var nameWidth = nameCell ? nameCell.offsetWidth : 150;
    var overallLeft = nameWidth;
    table.querySelectorAll('th.gb-overall-col-header, td.gb-overall-col').forEach(function (cell) {
      cell.style.left = overallLeft + 'px';
    });
  }

  /* ── Header row height resize (Scores view) ─────────────── */
  /* The slanted header's height: the one the teacher dragged to, kept on
     the teacher's preferences, or else just tall enough for the longest title, up to
     170px (a longer title ends in an ellipsis and shows whole on hover). */
  function _headerHeightPref() {
    return parseInt(getViewPref('gb_headerHeight') || '0', 10) || 0;
  }
  var _savedHeaderHeight = _headerHeightPref();
  var _headerHeight = _savedHeaderHeight || 170;

  var _measureCtx = null;
  function _fittedHeaderHeight() {
    var widest = 0;
    if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
    // Each title's own width in its font (the box it sits in is cut to the
    // header, so the page can't tell how long the words are).
    document
      .querySelectorAll('#gb-colheads .gb-scores-assess-name, #gb-colheads .gb-scores-assess-meta')
      .forEach(function (el) {
        var cs = getComputedStyle(el);
        _measureCtx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
        widest = Math.max(widest, _measureCtx.measureText(el.textContent).width);
      });
    // A title runs at 45°: its length is the height × √2 less the 40px the
    // label starts in (gradebook.css), plus a little air.
    return Math.max(100, Math.min(170, Math.ceil((widest + 48) / Math.SQRT2)));
  }

  function initHeaderResize() {
    var colheads = document.getElementById('gb-colheads');
    if (!colheads) return;
    // After signing in, the saved height arrives after this file loads.
    _savedHeaderHeight = _headerHeightPref();
    if (_savedHeaderHeight) _headerHeight = _savedHeaderHeight;
    // Add resize handle at bottom of colheads container
    var handle = colheads.querySelector('.gb-header-resize-handle');
    if (!handle) {
      handle = document.createElement('div');
      handle.className = 'gb-header-resize-handle';
      colheads.appendChild(handle);
    }
    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var startY = e.clientY;
      var startH = _headerHeight;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';

      function onMove(ev) {
        _headerHeight = Math.max(80, Math.min(400, startH + ev.clientY - startY));
        applyHeaderHeight();
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        _savedHeaderHeight = _headerHeight;
        saveViewPref('gb_headerHeight', _headerHeight);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    if (!_savedHeaderHeight) _headerHeight = _fittedHeaderHeight();
    applyHeaderHeight();
  }

  function applyHeaderHeight() {
    var container = document.getElementById('gb-colheads');
    // The tilted label's length, and the room the data area keeps for the
    // last labels, are derived from this in gradebook.css.
    var grid = container && container.closest('.gb-grid');
    if (grid) grid.style.setProperty('--gb-head-h', _headerHeight + 'px');
    var colheads = document.querySelectorAll('#gb-colheads .gb-grid-colhead');
    colheads.forEach(function (el) {
      el.style.height = _headerHeight + 'px';
    });
  }

  /* ── Column hover with 45-degree skew-aware hit-testing ── */
  var _hoveredColIdx = -1;

  /* The slanted header column under a point: { idx, el }, or null. Each
     title leans over the columns to its right, so the box under the pointer
     is often a different column; this follows the slant instead, the same
     band the hover highlights. */
  function _slantedColAt(clientX, clientY) {
    var inner = document.querySelector('#gb-colheads .gb-grid-colheads-inner');
    if (!inner) return null;
    var cols = inner.querySelectorAll('.gb-grid-colhead');
    if (!cols.length) return null;
    var innerRect = inner.getBoundingClientRect();
    var colW = cols[0].getBoundingClientRect().width;
    // innerRect.left already accounts for scroll — no scrollLeft needed
    var mouseX = clientX - innerRect.left;
    var mouseY = clientY - innerRect.top;
    // Skew correction: skewX(-45deg) with transform-origin:bottom-right
    // shifts fill RIGHT as you go up. At height h from bottom, column i's
    // fill spans [i*colW + h, (i+1)*colW + h]. To find column index:
    var hFromBottom = innerRect.height - mouseY;
    var idx = Math.floor((mouseX - hFromBottom) / colW);
    if (idx < 0 || idx >= cols.length) return null;
    return { idx: idx, el: cols[idx] };
  }

  function _inSlantedHeads(target) {
    return !!(
      target &&
      target.closest &&
      target.closest('#gb-colheads .gb-grid-colheads-inner:not(.gb-grid-colheads-comp)')
    );
  }

  function initColHoverTooltip() {
    var colheads = document.getElementById('gb-colheads');
    if (!colheads) return;
    // Use mousemove for skew-aware hit-testing instead of DOM hover
    colheads.addEventListener('mousemove', function (e) {
      var hit = _slantedColAt(e.clientX, e.clientY);
      var idx = hit ? hit.idx : -1;
      if (idx < 0) {
        if (_hoveredColIdx >= 0) hideColTooltip();
        return;
      }
      if (idx !== _hoveredColIdx) {
        hideColTooltip();
        _hoveredColIdx = idx;
        showColTooltip(hit.el, idx);
      }
    });
    colheads.addEventListener('mouseleave', function () {
      hideColTooltip();
    });
  }

  // The header and cells lit now, so the next column clears only them.
  var _colLit = [];
  function showColTooltip(colEl, colIdx) {
    // Highlight the column header and its score cells; no card, so
    // nothing covers the scores below.
    if (colEl) _colLit.push(colEl);
    var table = document.querySelector('#gb-data table');
    if (table) {
      table.querySelectorAll('tbody tr').forEach(function (row) {
        if (row.children[colIdx]) _colLit.push(row.children[colIdx]);
      });
    }
    _colLit.forEach(function (el) {
      el.classList.add('gb-col-hover');
    });
  }

  function hideColTooltip() {
    _hoveredColIdx = -1;
    _colLit.forEach(function (el) {
      el.classList.remove('gb-col-hover');
    });
    _colLit = [];
  }

  return {
    initGridHoverSync: initGridHoverSync,
    initGridScrollSync: initGridScrollSync,
    restoreGridScroll: restoreGridScroll,
    applyStickyLeft: applyStickyLeft,
    initHeaderResize: initHeaderResize,
    initColHoverTooltip: initColHoverTooltip,
    _slantedColAt: _slantedColAt,
    _inSlantedHeads: _inSlantedHeads,
  };
})();
