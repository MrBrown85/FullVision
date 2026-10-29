/* ── page-gradebook.js — Gradebook (spreadsheet) page module ── */
window.PageGradebook = (function () {
  'use strict';

  /* ── Listener tracking for cleanup ──────────────────────── */
  var _listeners = [];
  function _addDocListener(type, handler, options) {
    document.addEventListener(type, handler, options);
    _listeners.push({ type: type, handler: handler, options: options });
  }

  /* ── State variables ────────────────────────────────────── */
  var activeCourse;
  var viewMode = 'scores';
  /* The Competencies view shows a rubric assessment as one column per
     competency ('competencies', the default) or one per criterion
     ('criteria'). Remembered per class on this device. */
  function rubricColumnsMode(cid) {
    return localStorage.getItem('gb_rubricColumns_' + cid) === 'criteria' ? 'criteria' : 'competencies';
  }
  function setRubricColumns(mode) {
    localStorage.setItem('gb_rubricColumns_' + activeCourse, mode === 'criteria' ? 'criteria' : 'competencies');
    render();
  }
  /* "Newest first" puts the Competencies view's latest assessments on the
     left. Remembered on this device; the Scores view is always newest first. */
  var _newestFirst = false;
  try {
    _newestFirst = localStorage.getItem('gb_newestFirst') === '1';
  } catch (e) {
    /* storage blocked: oldest first */
  }
  function toggleNewestFirst() {
    _newestFirst = !_newestFirst;
    try {
      localStorage.setItem('gb_newestFirst', _newestFirst ? '1' : '0');
    } catch (e) {
      /* storage blocked: the order still changes until the page reloads */
    }
    render();
  }
  var _pinnedCols = { name: true, final: true }; // pinnable: name, categories, final
  var _undoStack = [];
  var _scoreMode = null; // null or { assessmentId, studentIdx }
  var filterSections = [];
  var filterModules = [];
  var filterCategories = [];
  // Students a dashboard link opened the gradebook on (?students=), until cleared.
  var filterStudentIds = [];
  var searchQuery = '';
  var searchText = ''; // what the box holds, spaces and capitals as typed
  var sortCol = null;
  var _filterStripOpen = false;
  var _printTerm = 'all';
  var _printShownIds = null;
  var _scrollShadowCleanup = null;
  var _scrollKey = null; // class and view of the last render, so a redraw keeps the table's scroll
  var _tipSource = null;
  /* Name-cell tooltip HTML, keyed on student.id. Populated by _setNameTip,
   * read by _showNameTip. Replaces the previous round-trip through
   * data-tip="…" (which relied on every contributor to `tip` using esc()
   * correctly so the browser's attribute-decode-plus-innerHTML cycle
   * reconstructed the intended HTML without injection). Keeping the HTML
   * in a JS-side map removes the attribute round-trip entirely. */
  var _nameTipHtml = {};
  function _flushActiveScoreEditor() {
    var active = document.activeElement;
    if (!active || typeof active.blur !== 'function' || !active.classList) return;
    if (!active.classList.contains('gb-scores-input') && !active.classList.contains('gb-pts-input')) return;
    active.blur();
  }

  /* ── Filter strip toggle ────────────────────────────────── */
  function toggleFilterStrip() {
    _filterStripOpen = !_filterStripOpen;
    var strip = document.getElementById('gb-filter-strip');
    if (strip) strip.classList.toggle('open', _filterStripOpen);
  }
  function clearAllFilters() {
    _flushActiveScoreEditor();
    filterCategories = [];
    filterSections = [];
    filterModules = [];
    render();
  }

  /* ── Course switch ──────────────────────────────────────── */
  function toggleModuleFilter(moduleId) {
    _flushActiveScoreEditor();
    var idx = filterModules.indexOf(moduleId);
    if (idx >= 0) filterModules.splice(idx, 1);
    else filterModules.push(moduleId);
    render();
  }
  async function switchCourse(cid) {
    _flushActiveScoreEditor();
    activeCourse = cid;
    if (!(await switchActiveCourse(cid))) return;
    filterStudentIds = [];
    filterSections = [];
    filterModules = [];
    filterCategories = [];
    render();
  }

  /* ── View & filter controls ─────────────────────────────── */
  // The Gradebook tab always opens on Scores; the choice lasts until the page is left.
  function setView(mode) {
    _flushActiveScoreEditor();
    viewMode = mode;
    render();
  }
  function toggleSectionFilter(secId) {
    _flushActiveScoreEditor();
    var idx = filterSections.indexOf(secId);
    if (idx >= 0) filterSections.splice(idx, 1);
    else filterSections.push(secId);
    render();
  }
  function toggleCategoryFilter(catId) {
    _flushActiveScoreEditor();
    var idx = filterCategories.indexOf(catId);
    if (idx >= 0) filterCategories.splice(idx, 1);
    else filterCategories.push(catId);
    render();
  }
  // The search box is redrawn with the page, so the new box gets the focus
  // and the caret back.
  function onSearch(val, caret) {
    searchText = val || '';
    searchQuery = searchText.toLowerCase().trim();
    render();
    var inp = document.querySelector('.gb-search-input');
    if (!inp) return;
    inp.focus();
    if (caret != null) inp.setSelectionRange(caret, caret);
  }
  /* Student name sort cycles on every click and loops:
     first name A–Z, first Z–A, last name A–Z, last Z–A. */
  var NAME_SORT_CYCLE = [
    { by: 'first', dir: 'asc' },
    { by: 'first', dir: 'desc' },
    { by: 'last', dir: 'asc' },
    { by: 'last', dir: 'desc' },
  ];
  function toggleSort(key) {
    _flushActiveScoreEditor();
    if (key === 'name') {
      var step = -1;
      if (sortCol && sortCol.key === 'name') {
        step = NAME_SORT_CYCLE.findIndex(function (c) {
          return c.by === sortCol.by && c.dir === sortCol.dir;
        });
      }
      var next = NAME_SORT_CYCLE[(step + 1) % NAME_SORT_CYCLE.length];
      sortCol = { key: 'name', by: next.by, dir: next.dir };
    } else if (sortCol && sortCol.key === key) sortCol.dir = sortCol.dir === 'asc' ? 'desc' : 'asc';
    else sortCol = { key: key, dir: 'asc' };
    render();
  }
  function sortArrow(key) {
    if (!sortCol || sortCol.key !== key) return '';
    return '<span class="gb-sort-arrow">' + (sortCol.dir === 'asc' ? '▲' : '▼') + '</span>';
  }

  function _getSortedCategories(cid) {
    return (getCategories(cid) || []).slice().sort(function (a, b) {
      var orderA = Number(a.displayOrder || 0);
      var orderB = Number(b.displayOrder || 0);
      if (orderA !== orderB) return orderA - orderB;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  function _getAssessmentCategoryId(assessment) {
    return (assessment && (assessment.categoryId || assessment.category_id)) || '';
  }

  function _getCategoryName(cid, categoryId) {
    if (!categoryId) return 'No Category';
    var category = getCategoryById(cid, categoryId);
    return category && category.name ? category.name : 'Unknown Category';
  }

  function _getAssessmentCategoryName(cid, assessment) {
    return _getCategoryName(cid, _getAssessmentCategoryId(assessment));
  }

  function _getAssessmentCategoryClass(assessment) {
    return _getAssessmentCategoryId(assessment) ? 'sum' : 'form';
  }

  function _getAssessmentAccentClass(assessment, prefix) {
    return _getAssessmentCategoryId(assessment) ? ' ' + prefix + '-summative' : ' ' + prefix + '-formative';
  }

  function _getStudentLetterData(cid, sid) {
    return getCourseLetterData(cid, sid) || { Q: null, R: null, S: null };
  }

  function _getDisplayedFinalPercent(cid, sid) {
    var letterData = _getStudentLetterData(cid, sid);
    if (letterData.R != null) return letterData.R;
    var overall = getOverallProficiency(cid, sid);
    return overall > 0 ? Math.round(levelToPercent(cid, overall) * 10) / 10 : null;
  }

  /* ══════════════════════════════════════════════════════════
     MAIN RENDER
     ══════════════════════════════════════════════════════════ */
  function render() {
    var cid = activeCourse;
    var students = sortStudents(getStudents(cid), 'lastName');
    // The class's chosen reporting term scopes the columns and every grade
    // on this page (calc.js). All time shows everything.
    var term = typeof activateSavedTerm === 'function' ? activateSavedTerm(cid) : null;
    var everyAssessment = getAssessments(cid);
    var allAssessments = everyAssessment
      .filter(function (a) {
        return !_pendingDeleteAids[a.id] && (!term || assessmentInActiveTerm(cid, a));
      })
      .sort(function (a, b) {
        return (a.date || '').localeCompare(b.date || '');
      });
    if (viewMode === 'detailed' && _newestFirst) allAssessments.reverse();
    var undatedCount = term ? undatedAssessmentCount(cid) : 0;
    var sections = getSections(cid);
    var course = COURSES[cid];
    var isLetter = courseShowsLetterGrades(course);
    var scores = getScores(cid);

    if (filterStudentIds.length) {
      students = students.filter(function (s) {
        return filterStudentIds.indexOf(s.id) >= 0;
      });
    }

    if (searchQuery) {
      students = students.filter(function (s) {
        return (
          displayName(s).toLowerCase().includes(searchQuery) ||
          (s.firstName || '').toLowerCase().includes(searchQuery) ||
          (s.lastName || '').toLowerCase().includes(searchQuery) ||
          (s.studentNumber || '').toLowerCase().includes(searchQuery)
        );
      });
    }

    var assessments = allAssessments;
    if (filterCategories.length > 0) {
      assessments = assessments.filter(function (a) {
        var catId = _getAssessmentCategoryId(a);
        return catId && filterCategories.indexOf(catId) >= 0;
      });
    }
    if (filterSections.length > 0) {
      assessments = assessments.filter(function (a) {
        return (a.tagIds || []).some(function (tid) {
          var sec = getSectionForTag(cid, tid);
          return sec && filterSections.includes(sec.id);
        });
      });
    }
    if (filterModules.length > 0) {
      assessments = assessments.filter(function (a) {
        return a.moduleId && filterModules.includes(a.moduleId);
      });
    }

    // What Print Grades offers as "Shown in the Gradebook": the columns the
    // filter chips leave, when any chip is on.
    _printTerm = term ? term.ordinal : 'all';
    _printShownIds =
      filterCategories.length + filterSections.length + filterModules.length > 0
        ? assessments.map(function (a) {
            return a.id;
          })
        : null;

    var html = '';

    // ── Toolbar ──
    var modules = getModules(cid);
    var activeFilterCount = filterCategories.length + filterSections.length + filterModules.length;

    html += '<div class="page-toolbar gb-toolbar">';
    var courseOpts = getPickerCourses(activeCourse)
      .map(function (c) {
        return (
          '<option value="' + c.id + '"' + (c.id === activeCourse ? ' selected' : '') + '>' + esc(c.name) + '</option>'
        );
      })
      .join('');
    html +=
      '<select class="class-picker gb-course-select" data-action="switchCourse" aria-label="Select course">' +
      courseOpts +
      '</select>';

    html +=
      '<div class="seg gb-seg-control" role="tablist" aria-label="View mode">' +
      '<button class="seg-btn gb-seg-btn' +
      (viewMode === 'scores' ? ' active' : '') +
      '" data-action="setView" data-mode="scores" role="tab" aria-selected="' +
      (viewMode === 'scores') +
      '">Scores</button>' +
      '<button class="seg-btn gb-seg-btn' +
      (viewMode === 'detailed' ? ' active' : '') +
      '" data-action="setView" data-mode="detailed" role="tab" aria-selected="' +
      (viewMode === 'detailed') +
      '">Competencies</button>' +
      '</div>';

    var hasRubricAssessment = allAssessments.some(function (a) {
      return rubricCriterionColumns(a, cid).length > 0;
    });
    if (viewMode === 'detailed' && hasRubricAssessment) {
      var rubricCols = rubricColumnsMode(cid);
      html +=
        '<select class="class-picker gb-rubric-cols-select" data-action="setRubricColumns" aria-label="Rubric columns">' +
        '<option value="competencies"' +
        (rubricCols === 'competencies' ? ' selected' : '') +
        '>Rubrics by Competency</option>' +
        '<option value="criteria"' +
        (rubricCols === 'criteria' ? ' selected' : '') +
        '>Rubrics by Criterion</option>' +
        '</select>';
    }

    html += typeof renderTermPicker === 'function' ? renderTermPicker(cid) : '';

    html +=
      '<button class="gb-filter-trigger' +
      (activeFilterCount > 0 ? ' has-filters' : '') +
      '" data-action="toggleFilterStrip" aria-expanded="' +
      _filterStripOpen +
      '" aria-label="Toggle filters' +
      (activeFilterCount > 0 ? ', ' + activeFilterCount + ' active' : '') +
      '">' +
      '<span class="filter-icon" aria-hidden="true">☰</span> Filters' +
      (activeFilterCount > 0 ? ' <span class="filter-count">' + activeFilterCount + '</span>' : '') +
      '</button>';

    html +=
      '<div class="gb-search-wrap"><span class="gb-search-icon">' +
      LINE_ICONS.search +
      '</span><input class="gb-search-input" type="text" placeholder="Search…" value="' +
      esc(searchText) +
      '" data-action-input="gbSearch" aria-label="Search students"></div>';

    if (filterStudentIds.length) {
      html +=
        '<button class="gb-student-filter" data-action="clearStudentFilter" aria-label="Show all students">Showing ' +
        filterStudentIds.length +
        ' Student' +
        (filterStudentIds.length === 1 ? '' : 's') +
        ' <span aria-hidden="true">\u00D7</span></button>';
    }

    html +=
      '<div style="margin-left:auto;display:flex;align-items:center;gap:12px">' +
      (undatedCount > 0
        ? '<span class="gb-toolbar-label" title="These assessments have no date, so no term can include them. Give them a date on the Assessments page.">' +
          undatedCount +
          ' Undated Not Shown</span>'
        : '') +
      (viewMode === 'scores'
        ? '<button class="tb-toggle-btn" data-action="exportScoresCSV" title="Export CSV">\u2913 Export</button>'
        : '') +
      '<button class="tb-action-btn tb-action-secondary" data-action="printGrades">Print Grades</button>' +
      '<a class="tb-action-btn" role="link" tabindex="0" data-href="/assignments?course=' +
      activeCourse +
      '&new=1">+ New Assessment</a>' +
      '</div>';
    html += '</div>';

    // ── Filter strip ──
    html += '<div class="gb-filter-strip' + (_filterStripOpen ? ' open' : '') + '" id="gb-filter-strip">';
    var sortedCategories = _getSortedCategories(cid);
    if (sortedCategories.length > 0) {
      html += '<span class="gb-filter-strip-label">Category</span><div class="gb-filter-strip-group">';
      sortedCategories.forEach(function (cat, i) {
        var t = typeof categoryTintByIndex === 'function' ? categoryTintByIndex(i, cat.name) : { fg: '' };
        var isActive = filterCategories.indexOf(cat.id) >= 0;
        html +=
          '<button class="gb-filter-chip' +
          (isActive ? ' active' : '') +
          '" data-action="toggleCategoryFilter" data-catid="' +
          esc(cat.id) +
          '"><span class="chip-dot" style="background:' +
          t.fg +
          '"></span>' +
          esc(cat.name) +
          '</button>';
      });
      html += '</div>';
    }

    html +=
      (sortedCategories.length > 0 ? '<div class="gb-filter-strip-divider"></div>' : '') +
      '<span class="gb-filter-strip-label">Outcomes</span><div class="gb-filter-strip-group">';
    sections.forEach(function (sec) {
      var isActive = filterSections.includes(sec.id);
      html +=
        '<button class="gb-filter-chip' +
        (isActive ? ' active' : '') +
        '" data-action="toggleSectionFilter" data-secid="' +
        sec.id +
        '"><span class="chip-dot" style="background:' +
        sec.color +
        '"></span>' +
        esc(sec.shortName || sec.name) +
        '</button>';
    });
    html += '</div>';

    if (modules.length > 0) {
      html +=
        '<div class="gb-filter-strip-divider"></div><span class="gb-filter-strip-label">Modules</span><div class="gb-filter-strip-group">';
      modules.forEach(function (u) {
        var isActive = filterModules.includes(u.id);
        html +=
          '<button class="gb-filter-chip' +
          (isActive ? ' active' : '') +
          '" data-action="toggleModuleFilter" data-moduleid="' +
          u.id +
          '"><span class="chip-dot" style="background:' +
          u.color +
          '"></span>' +
          esc(u.name) +
          '</button>';
      });
      html += '</div>';
    }

    if (activeFilterCount > 0) {
      html += '<button class="gb-filter-clear" data-action="clearAllFilters">Clear all</button>';
    }
    html += '</div>';

    // ── Table ──
    if (assessments.length === 0) {
      var secLabel = filterSections.length > 0 ? ' in the selected sections' : '';
      html +=
        '<div style="text-align:center;padding:60px 20px;color:var(--text-3)">' +
        '<div style="font-family:var(--font-base);font-size:0.95rem;margin-bottom:4px">No assignments found' +
        secLabel +
        '.</div>' +
        '<div style="font-family:var(--font-base);font-size:0.875rem">Try adjusting your filters or <a role="link" tabindex="0" data-href="/assignments?course=' +
        cid +
        '" style="color:var(--link)">create a new assessment</a>.</div>' +
        '</div>';
    } else if (viewMode === 'scores') {
      html += renderScoresTable(cid, students, assessments, sections, isLetter, scores);
    } else {
      html += renderDetailedTable(cid, students, assessments, sections, isLetter, scores);
    }

    // A redraw (a saved score, a sort, a filter) leaves the table where it
    // was; another class or view starts at the top.
    var scrollKey = cid + '|' + viewMode;
    var prevData = document.getElementById('gb-data');
    var keepScroll =
      prevData && _scrollKey === scrollKey ? { top: prevData.scrollTop, left: prevData.scrollLeft } : null;
    _scrollKey = scrollKey;

    document.getElementById('main').innerHTML = html;
    applyStickyLeft();
    initScrollShadows();
    initGridScrollSync();
    if (keepScroll) restoreGridScroll(keepScroll);
    initGridHoverSync();
    initHeaderResize();
    initColHoverTooltip();
  }

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
  }

  /* ── 4-quadrant grid scroll sync ─────────────────────────── */
  var _gridScrollHandler = null;
  function initGridScrollSync() {
    // Remove previous listener to prevent stacking
    if (_gridScrollHandler && _gridScrollHandler.el) {
      _gridScrollHandler.el.removeEventListener('scroll', _gridScrollHandler.fn);
    }
    var data = document.getElementById('gb-data');
    var colheads = document.getElementById('gb-colheads');
    var colheadsInner = colheads && colheads.querySelector('.gb-grid-colheads-inner');
    var rowheads = document.getElementById('gb-rowheads');
    if (!data || !colheads || !rowheads) return;
    var pad = 0;
    var fn = function () {
      // The data area's horizontal scrollbar shortens its view; the names
      // get the same room at the bottom so the last rows still line up.
      var gap = data.scrollHeight - data.clientHeight - (rowheads.scrollHeight - rowheads.clientHeight);
      if (gap && pad + gap >= 0) {
        pad += gap;
        rowheads.style.setProperty('--gb-hscroll', pad + 'px');
      }
      if (colheadsInner) colheadsInner.style.transform = 'translateX(-' + data.scrollLeft + 'px)';
      rowheads.scrollTop = data.scrollTop;
    };
    data.addEventListener('scroll', fn, { passive: true });
    _gridScrollHandler = { el: data, fn: fn };
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
  var _headerHeight = parseInt(localStorage.getItem('gb_headerHeight') || '200', 10);

  function initHeaderResize() {
    var colheads = document.getElementById('gb-colheads');
    if (!colheads) return;
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
        localStorage.setItem('gb_headerHeight', _headerHeight);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
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

  function showColTooltip(colEl, colIdx) {
    // Highlight the skewed column header and its score cells; no card, so
    // nothing covers the scores below.
    colEl.classList.add('gb-col-hover');
    var table = document.querySelector('.gb-scores-table');
    if (table) {
      table.querySelectorAll('tbody tr').forEach(function (row) {
        var cell = row.children[colIdx];
        if (cell) cell.classList.add('gb-col-hover');
      });
    }
  }

  function hideColTooltip() {
    _hoveredColIdx = -1;
    document.querySelectorAll('.gb-col-hover').forEach(function (el) {
      el.classList.remove('gb-col-hover');
    });
  }

  /* ── Scroll shadow indicators ──────────────────────────── */
  function initScrollShadows() {
    if (_scrollShadowCleanup) {
      _scrollShadowCleanup();
      _scrollShadowCleanup = null;
    }
    var wrap = document.querySelector('.gb-scroll-wrap');
    var scroller = document.querySelector('.gb-scroll');
    if (!wrap || !scroller) return;
    function update() {
      var sl = scroller.scrollLeft;
      var maxSl = scroller.scrollWidth - scroller.clientWidth;
      wrap.classList.toggle('shadow-left', sl > 4);
      wrap.classList.toggle('shadow-right', sl < maxSl - 4);
    }
    scroller.addEventListener('scroll', update, { passive: true });
    _scrollShadowCleanup = function () {
      scroller.removeEventListener('scroll', update);
    };
    requestAnimationFrame(update);
  }

  /* A student's name in the grid's left column: a link to their page. */
  function _rowheadNameOpen(cid, s) {
    return (
      '<a class="gb-grid-rowhead-name" role="link" tabindex="0" data-sid="' +
      esc(s.id) +
      '" data-href="/student?id=' +
      encodeURIComponent(s.id) +
      '&course=' +
      encodeURIComponent(cid) +
      '">'
    );
  }

  /* The short code teachers know a competency by ("QAP1"). Tags loaded from
     the server have a long random id, so the id is used only when it is a
     readable code itself, as in Demo Mode. */
  function _tagShortCode(tag) {
    if (!tag) return '';
    return tag.code || (!_isUuid(tag.id) && tag.id) || tag.shortName || tag.label || '';
  }

  /* ══════════════════════════════════════════════════════════
     DETAILED VIEW
     ══════════════════════════════════════════════════════════ */
  /* The columns a rubric assessment gets in Criteria mode: one per
     criterion, showing the score under the criterion's first key (its first
     competency, or its own id when it has none). `tagIds` are the keys left
     after the section filter; a criterion none of whose keys survive is
     left out. Empty when the assessment has no rubric. */
  function _criterionColumns(cid, a, tagIds) {
    return rubricCriterionColumns(a, cid)
      .filter(function (c) {
        return c.keys.some(function (key) {
          return tagIds.indexOf(key) >= 0;
        });
      })
      .map(function (c) {
        var tags = c.criterion.tagIds || [];
        var codes = tags
          .map(function (tid) {
            var tag = getTagById(cid, tid);
            return tag ? _tagShortCode(tag) || tag.label : '';
          })
          .filter(Boolean);
        var sec = tags.length ? getSectionForTag(cid, tags[0]) : null;
        var name = c.criterion.name || 'Criterion';
        return {
          assessmentId: a.id,
          tagId: c.keys[0],
          tagIds: c.keys,
          isCriterionCol: true,
          tagCode: name,
          sectionColor: sec ? sec.color : 'var(--text-3)',
          tagText: codes.length
            ? name + ' \u00b7 ' + codes.join(', ')
            : name + ': counts toward the overall grade only',
        };
      });
  }

  /* The competencies a criterion key stands for: a criterion's competencies,
     or the key itself for a competency or a criterion with none. */
  function _keyCompetencyIds(cid, a, key) {
    var rubric =
      a && (a.rubricId || a.rubric_id) && !isPointsScored(a) ? getRubricById(cid, a.rubricId || a.rubric_id) : null;
    var crit =
      rubric &&
      (rubric.criteria || []).find(function (c) {
        return c && c.id === key;
      });
    return crit && crit.tagIds && crit.tagIds.length ? crit.tagIds : [key];
  }

  /* Rubric work in the Competencies columns: a column per competency the
     criteria feed (a criterion with none keeps its own column), read from
     the criteria. Rubrics by Criterion keeps a column per criterion. */
  function _competencyColumnKeys(cid, a, keys) {
    var out = [];
    keys.forEach(function (key) {
      _keyCompetencyIds(cid, a, key).forEach(function (t) {
        if (out.indexOf(t) < 0) out.push(t);
      });
    });
    return out;
  }

  function renderDetailedTable(cid, students, assessments, sections, isLetter, scores) {
    var cols = [];
    var groups = [];
    var groupIdx = 0;
    var byCriterion = rubricColumnsMode(cid) === 'criteria';
    assessments.forEach(function (a) {
      // Competencies, rubric criteria with none, or one overall column.
      var tagIds = scoreTagIds(a, cid);
      if (!byCriterion) tagIds = _competencyColumnKeys(cid, a, tagIds);
      if (filterSections.length > 0) {
        tagIds = tagIds.filter(function (tid) {
          return _keyCompetencyIds(cid, a, tid).some(function (t) {
            var sec = getSectionForTag(cid, t);
            return sec && filterSections.includes(sec.id);
          });
        });
      }
      if (tagIds.length === 0) return;
      var start = cols.length;
      var criterionCols = byCriterion && !isPointsScored(a) ? _criterionColumns(cid, a, tagIds) : [];
      if (criterionCols.length > 0) {
        criterionCols.forEach(function (col) {
          cols.push(col);
        });
      } else if (isPointsScored(a)) {
        var sec = getSectionForTag(cid, tagIds[0]);
        cols.push({
          assessmentId: a.id,
          tagId: '__pts__',
          isPointsCol: true,
          tagCode: isCompletionScored(a) ? '\u2713/\u2717' : '/' + (a.maxPoints || 100),
          sectionColor: sec ? sec.color : 'var(--text-3)',
          tagText: a.title,
        });
      } else {
        tagIds.forEach(function (tagId) {
          var key = scoreKeyInfo(cid, a, tagId);
          var sec = getSectionForTag(cid, tagId);
          // A competency column of rubric work reads the criteria that feed
          // it, looked up once here for every row.
          var rubricCriteria = byCriterion ? [] : rubricCriteriaForTag(cid, a, tagId);
          cols.push({
            assessmentId: a.id,
            tagId: tagId,
            rubricCriteria: rubricCriteria.length ? rubricCriteria : null,
            // A competency's short code, never its server id; a criterion's
            // name; '?' for one no longer in the learning map.
            tagCode: key && key.tag ? _tagShortCode(key.tag) || key.label : key ? key.label : '?',
            sectionColor: sec ? sec.color : 'var(--text-3)',
            tagText: key ? key.text || key.label : 'No longer in the learning map',
          });
        });
      }
      var colCount = cols.length - start;
      var unitW = criterionCols.length > 0 ? 96 : 54;
      var groupW = Math.max(120, colCount * unitW);
      var colW = colCount === 1 ? groupW : unitW;
      // Set colWidth on each column in this group
      for (var ci = start; ci < cols.length; ci++) cols[ci].colWidth = colW;
      groups.push({ assessment: a, startIdx: start, count: colCount, groupIdx: groupIdx++, groupW: groupW });
    });
    var colGroupMap = cols.map(function (_, i) {
      return groups.find(function (g) {
        return i >= g.startIdx && i < g.startIdx + g.count;
      });
    });
    var sortedStudents = applySorting(cid, students, sections, isLetter);

    // 4-quadrant grid layout
    var html = '<div class="gb-grid gb-grid-comp">';

    // Q1: Corner (Student + Overall labels)
    html +=
      '<div class="gb-grid-corner gb-grid-corner-comp">' +
      '<button class="tb-toggle-btn gb-newest-first' +
      (_newestFirst ? ' active' : '') +
      '" data-action="toggleNewestFirst" aria-pressed="' +
      _newestFirst +
      '" title="Put the latest assessments on the left">Newest first</button>' +
      '<div class="gb-grid-corner-row1"><button type="button" class="gb-grid-corner-label gb-name-sort" data-action="toggleSort" data-sortkey="name">Student' +
      sortArrow('name') +
      '</button><span class="gb-grid-corner-label">Overall</span></div>' +
      '</div>';

    // Q2: Column headers — assessment names (row 1) + tag codes (row 2)
    html += '<div class="gb-grid-colheads" id="gb-colheads"><div class="gb-grid-colheads-inner gb-grid-colheads-comp">';
    // Row 1: assessment group headers
    html += '<div class="gb-grid-colheads-row1">';
    groups.forEach(function (g) {
      var a = g.assessment;
      var categoryName = _getAssessmentCategoryName(cid, a);
      var categoryClass = _getAssessmentCategoryClass(a);
      var typeClass = _getAssessmentAccentClass(a, 'gb-type');
      var tagSecs = (a.tagIds || [])
        .map(function (tid) {
          return getSectionForTag(cid, tid);
        })
        .filter(Boolean);
      var stripeColor = tagSecs.length > 0 ? tagSecs[0].color : 'var(--border)';
      var badges = '';
      if (isCompletionScored(a)) badges += '<span class="gb-assess-badge">\u2713/\u2717</span>';
      else if (a.scoreMode === 'points')
        badges += '<span class="gb-assess-badge">/ ' + (a.maxPoints || 100) + '</span>';
      if (getAssessmentWeight(a) !== 1) badges += '<span class="gb-assess-badge">' + a.weight + 'x</span>';
      var _catId = _getAssessmentCategoryId(a);
      var _catIdx = _catId
        ? (getCategories(cid) || []).findIndex(function (c) {
            return c.id === _catId;
          })
        : -1;
      var catTint =
        typeof categoryTintByIndex === 'function' ? categoryTintByIndex(_catIdx, categoryName) : { bg: '', fg: '' };
      html +=
        '<div class="gb-grid-assess-group' +
        typeClass +
        '" style="width:' +
        g.groupW +
        'px">' +
        '<a class="gb-assess-title" role="link" tabindex="0" data-href="/assignments?course=' +
        cid +
        '&open=' +
        a.id +
        '">' +
        esc(a.title) +
        '</a>' +
        '<div class="gb-assess-meta"><span class="gb-assess-type-pill ' +
        categoryClass +
        '" style="background:' +
        catTint.bg +
        ';color:' +
        catTint.fg +
        '" title="' +
        esc(categoryName) +
        '">' +
        esc(categoryName) +
        '</span><span class="gb-assess-date">' +
        formatShortDate(a.date) +
        '</span>' +
        badges +
        '</div>' +
        '<div class="gb-assess-stripe" style="background:' +
        stripeColor +
        '"></div>' +
        '</div>';
    });
    html += '</div>';
    // Row 2: tag code headers
    html += '<div class="gb-grid-colheads-row2">';
    cols.forEach(function (col, i) {
      var g = colGroupMap[i];
      var altClass = g && g.groupIdx % 2 === 1 ? ' gb-group-alt' : '';
      var tagW = col.colWidth || 54;
      html +=
        '<div class="gb-grid-tag-header' +
        altClass +
        (col.isCriterionCol ? ' gb-grid-tag-header-crit' : '') +
        // A code longer than five characters drops a size so it still fits.
        (!col.isCriterionCol && String(col.tagCode || '').length > 5 ? ' gb-code-long' : '') +
        '" style="flex:0 0 ' +
        tagW +
        'px;width:' +
        tagW +
        'px;border-bottom-color:' +
        col.sectionColor +
        ';color:' +
        col.sectionColor +
        '" title="' +
        esc(col.tagText || col.tagCode) +
        '">' +
        esc(col.tagCode) +
        '</div>';
    });
    html += '</div>';
    html += '</div></div>';

    // Q3: Row headers — student name + overall
    html += '<div class="gb-grid-rowheads" id="gb-rowheads">';
    sortedStudents.forEach(function (s, si) {
      var altClass = si % 2 === 1 ? ' gb-scores-alt' : '';
      var overall = getOverallProficiency(cid, s.id);
      var grade = studentGradeSummary(cid, s.id);
      var color = PROF_COLORS[grade.level] || PROF_COLORS[0];
      var label = levelWord(cid, overall);
      _setNameTip(cid, s, sections);
      html +=
        '<div class="gb-grid-rowhead gb-grid-rowhead-comp' +
        altClass +
        '">' +
        _rowheadNameOpen(cid, s) +
        esc(fullName(s)) +
        '</a>' +
        '<span class="gb-grid-rowhead-overall" style="color:' +
        color +
        '">' +
        (grade.text || '\u2014') +
        (label ? '<small>' + label + '</small>' : '') +
        '</span>' +
        '</div>';
    });
    // Stats row header
    html += '<div class="gb-grid-rowhead gb-grid-rowhead-comp gb-grid-rowhead-stats">Class Average</div>';
    html += '</div>';

    // Q4: Data cells — score grid
    html += '<div class="gb-grid-data" id="gb-data"><table class="gb-table"><tbody>';
    sortedStudents.forEach(function (s) {
      html += '<tr data-sid="' + s.id + '">';
      cols.forEach(function (col, i) {
        var g = colGroupMap[i];
        var startClass = g && g.groupIdx > 0 && g.startIdx === i ? ' gb-group-start' : '';
        var altClass = g && g.groupIdx % 2 === 1 ? ' gb-group-alt' : '';
        var cellW = col.colWidth || 54;
        var cellStyle = cellW !== 54 ? ' style="min-width:' + cellW + 'px;width:' + cellW + 'px"' : '';
        var assess = assessments.find(function (a) {
          return a.id === col.assessmentId;
        });
        // Not submitted and Excused replace the score.
        var statusMark = scoreStatusMarker(getAssignmentStatus(cid, s.id, col.assessmentId), cid, assess);
        if (col.isPointsCol && isCompletionScored(assess)) {
          var mark = getCompletionMark(cid, s.id, col.assessmentId);
          html +=
            '<td class="gb-score gb-score-pts' +
            startClass +
            altClass +
            '"' +
            cellStyle +
            ' data-aid="' +
            col.assessmentId +
            '" data-pts="1" data-cmp="1" data-sid="' +
            s.id +
            '" data-action="cycleScore" title="' +
            (mark ? (mark === 'complete' ? 'Complete' : 'Incomplete') : '') +
            '">' +
            (statusMark || completionCellHtml(mark)) +
            '</td>';
        } else if (col.isPointsCol) {
          var max = assess.maxPoints || 100;
          var score = getPointsScore(cid, s.id, col.assessmentId);
          var pct = score != null ? ((score / max) * 100).toFixed(1) : '0.0';
          var title = score != null ? formatPoints(score) + '/' + max + ' (' + pct + '%)' : '';
          var cellContent =
            score != null
              ? '<div class="gb-pts-display"><span class="gb-pts-score">' +
                formatPoints(score) +
                '<span class="gb-pts-max">/' +
                max +
                '</span></span><span class="gb-pts-pct">' +
                pct +
                '%</span></div>'
              : '<span class="gb-pts-empty">\u00B7</span>';
          html +=
            '<td class="gb-score gb-score-pts' +
            startClass +
            altClass +
            '"' +
            cellStyle +
            ' data-aid="' +
            col.assessmentId +
            '" data-pts="1" data-sid="' +
            s.id +
            '" data-max="' +
            max +
            '" data-action="cycleScore" title="' +
            title +
            '">' +
            (statusMark || cellContent) +
            '</td>';
        } else {
          var studentScores = scores[s.id] || [];
          // A competency column of rubric work reads the criteria that feed
          // it, and is scored on the rubric, not here. Criteria that
          // disagree show the lowest, marked.
          var rubricCol = !!(col.rubricCriteria && assess);
          var entry = rubricCol
            ? competencyLevelFromCriteria(cid, s.id, assess, col.tagId, col.rubricCriteria)
            : studentScores.find(function (e) {
                return e.assessmentId === col.assessmentId && e.tagId === col.tagId;
              });
          var score = entry ? entry.score : 0;
          var mixed = !!(entry && entry.mixed);
          var assigned = rubricCol || (assess && scoreTagIds(assess, cid).includes(col.tagId));
          var content = statusMark
            ? statusMark
            : score > 0
              ? formatScoreLevel(score, entry.mod)
              : assigned
                ? '<span class="gb-unscored">\u00B7</span>'
                : '\u2014';
          var rubricTitle = mixed
            ? 'The criteria on this competency disagree; the lowest is shown. Scored on the rubric in Assignments'
            : 'Scored on the rubric in Assignments';
          html +=
            '<td class="gb-score' +
            startClass +
            altClass +
            '"' +
            cellStyle +
            ' data-aid="' +
            col.assessmentId +
            '" data-tid="' +
            col.tagId +
            (col.tagIds && col.tagIds.length > 1 ? '" data-tids="' + esc(col.tagIds.join(',')) : '') +
            '" data-sid="' +
            s.id +
            '"' +
            (rubricCol ? ' title="' + rubricTitle + '"' : ' data-action="cycleScore"') +
            '><span class="gb-score-val s' +
            score +
            (mixed ? ' gb-mixed' : '') +
            '">' +
            content +
            '</span></td>';
        }
      });
      html += '</tr>';
    });

    // Stats row (grid version — no name/overall cells, those are in Q3)
    html += '<tr class="gb-stats-row">';
    var _statsColGroupMap = cols.map(function (_, i) {
      return groups.find(function (g) {
        return i >= g.startIdx && i < g.startIdx + g.count;
      });
    });
    cols.forEach(function (col, i) {
      var g = _statsColGroupMap[i];
      var startClass = g && g.groupIdx > 0 && g.startIdx === i ? ' gb-group-start' : '';
      var altClass = g && g.groupIdx % 2 === 1 ? ' gb-group-alt' : '';
      var cellW = col.colWidth || 54;
      var wStyle = cellW !== 54 ? 'min-width:' + cellW + 'px;width:' + cellW + 'px;' : '';
      if (col.isPointsCol) {
        html += _pointsAverageCell(cid, sortedStudents, col, startClass + altClass, wStyle);
        return;
      }
      // calc.js's one column rule; a criterion column (Rubrics by Criterion)
      // averages every competency the criterion feeds.
      var stats = classColumnAverage(cid, sortedStudents, {
        assessment: assessments.find(function (a) {
          return a.id === col.assessmentId;
        }),
        tagIds: col.tagIds || [col.tagId],
      });
      if (!stats)
        html +=
          '<td class="gb-score' +
          startClass +
          altClass +
          '" style="' +
          wStyle +
          'cursor:default"><span class="gb-score-val s0" style="background:transparent">\u2014</span></td>';
      else {
        html +=
          '<td class="gb-score' +
          startClass +
          altClass +
          '" style="' +
          wStyle +
          'cursor:default"><span class="gb-avg-val" style="color:' +
          PROF_COLORS[Math.round(stats.avg)] +
          ';font-weight:700">' +
          formatLevel(cid, stats.avg) +
          '</span></td>';
      }
    });
    html += '</tr>';
    html += '</tbody></table></div></div>';
    return html;
  }

  /* ══════════════════════════════════════════════════════════
     SCORES VIEW — Apple Numbers-inspired spreadsheet
     ══════════════════════════════════════════════════════════ */
  function renderScoresTable(cid, students, assessments, sections, isLetter, scores) {
    var sortedStudents = applySorting(cid, students, sections, isLetter);
    var cw = getCategoryWeights(cid);
    var rowH = '';

    // Assignments sorted newest-first (left)
    var sortedAssess = assessments.slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });

    var html = '';
    var rowPx = 40;

    // 4-quadrant grid: corner | col-headers / row-headers | data
    html += '<div class="gb-grid">';

    // Q1: Corner (top-left, fixed)
    html +=
      '<div class="gb-grid-corner"><button type="button" class="gb-grid-corner-inner gb-name-sort" data-action="toggleSort" data-sortkey="name">Student' +
      sortArrow('name') +
      '</button></div>';

    // Q2: Column headers (top-right, scrolls horizontally)
    html += '<div class="gb-grid-colheads" id="gb-colheads"><div class="gb-grid-colheads-inner">';
    sortedAssess.forEach(function (a) {
      var categoryId = _getAssessmentCategoryId(a);
      var categoryName = _getCategoryName(cid, categoryId);
      var typeClass = _getAssessmentAccentClass(a, 'gb-scores');
      var isScoreOnly = isPointsScored(a);
      var maxPts = isScoreOnly ? ' / ' + (a.maxPoints || 100) : '';
      var tagSecs = (a.tagIds || [])
        .map(function (tid) {
          return getSectionForTag(cid, tid);
        })
        .filter(Boolean);
      var stripeColor = tagSecs.length > 0 ? tagSecs[0].color : 'var(--border)';
      var fillColor = isScoreOnly ? 'var(--surface)' : stripeColor;
      var stripeBottom = isScoreOnly ? 'var(--border)' : stripeColor;
      html +=
        '<div class="gb-grid-colhead' +
        typeClass +
        (isScoreOnly ? ' gb-colhead-score-only' : '') +
        '" data-aid="' +
        a.id +
        '" data-action-dblclick="startScoreMode">' +
        '<div class="gb-grid-colhead-text">' +
        '<div class="gb-grid-colhead-fill" style="background:' +
        fillColor +
        '"></div>' +
        '<div class="gb-grid-colhead-label" title="' +
        esc(a.title) +
        '">' +
        '<span class="gb-scores-assess-name">' +
        esc(a.title) +
        '</span>' +
        '<span class="gb-scores-assess-meta">' +
        formatShortDate(a.date) +
        maxPts +
        '</span>' +
        '</div>' +
        '</div>' +
        '<div class="gb-grid-colhead-stripe" style="background:' +
        stripeBottom +
        '"></div>' +
        '</div>';
    });
    html += '</div></div>';

    // Q3: Row headers (bottom-left, scrolls vertically)
    html += '<div class="gb-grid-rowheads" id="gb-rowheads">';
    sortedStudents.forEach(function (s, si) {
      var altClass = si % 2 === 1 ? ' gb-scores-alt' : '';
      // The overall grade as the class is set to show it (calc.js): the
      // proficiency, the letter and %, or both stacked, each in its colour.
      var badges = studentGradeBadges(cid, s.id);
      var gradeParts = [badges.prof, badges.letter].filter(Boolean);
      var desTags = (s.designations || [])
        .map(function (code) {
          var d = designationInfo(code);
          if (!d) return '';
          return (
            '<span class="gb-des-tag" title="' +
            esc(code) +
            ' \u2014 ' +
            esc(d.name) +
            (d.iep ? ' \u00b7 IEP' : '') +
            (d.modified ? ' \u00b7 Modified' : '') +
            '">' +
            esc(code) +
            '</span>'
          );
        })
        .join('');
      _setNameTip(cid, s, sections);
      html +=
        '<div class="gb-grid-rowhead' +
        altClass +
        '">' +
        _rowheadNameOpen(cid, s) +
        esc(fullName(s)) +
        desTags +
        '</a>' +
        '<span class="gb-grid-rowhead-grade">' +
        (gradeParts.length
          ? gradeParts
              .map(function (p) {
                return (
                  '<span style="color:' + (PROF_COLORS[p.level] || PROF_COLORS[0]) + '">' + esc(p.text) + '</span>'
                );
              })
              .join('')
          : '<span style="color:var(--text-3)">\u2014</span>') +
        '</span>' +
        '</div>';
    });
    html += '</div>';

    // Q4: Data cells (bottom-right, scrolls both ways — drives the others)
    html += '<div class="gb-grid-data" id="gb-data"><table class="gb-scores-table ' + rowH + '" role="grid"><tbody>';
    sortedStudents.forEach(function (s, si) {
      var altClass = si % 2 === 1 ? ' gb-scores-alt' : '';
      html += '<tr class="gb-scores-row' + altClass + '" data-sid="' + s.id + '">';

      // Score cells per assignment
      sortedAssess.forEach(function (a) {
        // What the cell holds comes from calc.js, the same value the printed
        // grade sheet prints; this view adds only its colours and markup.
        var cell = assessmentCellValue(cid, s.id, a);
        var val = cell.value;
        var display,
          cellStyle,
          cellClass = '';
        var cmpMark = cell.mark;
        var cellStatus = cell.status;
        var statusMark = cell.kind === 'status' ? scoreStatusMarker(cellStatus, cid, a) : '';
        if (statusMark) {
          // Not submitted and Excused replace the score.
          cellStyle = 'color:var(--text-3)';
          display = statusMark;
        } else if (cmpMark) {
          cellStyle = cmpMark === 'complete' ? 'color:var(--score-3)' : 'color:var(--score-1)';
          display = cell.text;
        } else if (cell.kind === 'points' || cell.kind === 'level') {
          var r = cell.level;
          cellStyle = 'background:' + PROF_TINT[r] + ';color:' + PROF_COLORS[r];
          display = cell.text;
          // Warning for out-of-range: above 4 on proficiency work, above the
          // extra-credit cap (twice the maximum) on points work.
          if (cell.outOfRange) cellClass = ' gb-scores-warning';
        } else if (cell.kind === 'dibels' && cell.dibels) {
          // A DIBELS benchmark's latest reading level, as a word; not a grade.
          var dl = { above: 4, core: 3, strategic: 2, intensive: 1 }[cell.dibels.level] || 0;
          cellStyle = dl ? 'background:' + PROF_TINT[dl] + ';color:' + PROF_COLORS[dl] : 'color:var(--text-3)';
          display = '<span class="gb-scores-dibels">' + esc(cell.text) + '</span>';
        } else if (cell.kind === 'missing' && cell.zero) {
          cellStyle = 'color:var(--score-1)';
          display = '<span class="gb-scores-zero">0</span>';
        } else if (cell.kind === 'missing') {
          cellStyle = 'background:rgba(255,149,0,0.06);color:var(--text-3)';
          display = '<span class="gb-scores-missing">\u2014</span>';
        } else {
          cellStyle = 'color:var(--text-3)';
          display = '\u2014';
        }
        var isScoreModeCell = _scoreMode && _scoreMode.assessmentId === a.id && si === _scoreMode.studentIdx;
        var isScoreModeCol = _scoreMode && _scoreMode.assessmentId === a.id;
        html +=
          '<td class="gb-scores-cell' +
          (isScoreModeCell ? ' gb-scores-focus' : '') +
          (isScoreModeCol ? ' gb-scores-col-active' : '') +
          cellClass +
          '" style="' +
          cellStyle +
          '" role="gridcell" aria-label="' +
          esc(fullName(s)) +
          ', ' +
          esc(a.title) +
          ': ' +
          (statusMark
            ? cellStatus === 'NS'
              ? 'Missing'
              : 'Excused'
            : cmpMark
              ? cmpMark === 'complete'
                ? 'Complete'
                : 'Incomplete'
              : val > 0
                ? display.replace(/<[^>]*>/g, '')
                : 'no score') +
          '" data-action="editScoreCell" data-aid="' +
          a.id +
          '" data-sid="' +
          s.id +
          '">' +
          '<span class="gb-scores-val">' +
          display +
          '</span>' +
          '</td>';
      });

      html += '</tr>';
    });
    html += '</tbody></table></div></div>'; // close table + data + grid
    return html;
  }

  /* ── Always-visible Overall column ──────────────────────── */
  function renderOverallHeader(rowspan) {
    var rs = rowspan ? ' rowspan="' + rowspan + '"' : '';
    return (
      '<th class="gb-overall-col-header gb-sortable"' +
      rs +
      ' data-action="toggleSort" data-sortkey="overall">Overall' +
      sortArrow('overall') +
      '</th>'
    );
  }
  // The overall grade as the class is set to grade: the level out of 4 in a
  // Proficiency or Both class (Both adds a Grade column), the letter and %
  // in a Letter class.
  function renderOverallCell(cid, sid) {
    var val = getOverallProficiency(cid, sid);
    var grade = courseGradeMode(cid) === 'letter' ? studentGradeSummary(cid, sid) : null;
    var r = grade ? grade.level : Math.round(val);
    var color = PROF_COLORS[r] || PROF_COLORS[0];
    var label = levelWord(cid, val);
    var num = grade ? grade.text || '—' : val > 0 ? val.toFixed(1) : '—';
    var tint = PROF_TINT[r] || '';
    var bg = tint ? 'background:linear-gradient(' + tint + ',' + tint + '),var(--bg)' : '';
    return (
      '<td class="gb-overall-col"' +
      (bg ? ' style="' + bg + '"' : '') +
      '><span class="gb-overall-num" style="color:' +
      color +
      '">' +
      num +
      '</span>' +
      (label ? '<div class="gb-overall-label" style="color:' + color + '">' + label + '</div>' : '') +
      '</td>'
    );
  }
  /* The tooltip on a student's name, in two groups so the two kinds of
     number never sit side by side: the course grade as the class shows it
     (with how many assignments are NS, which count as 0 toward a %) and
     each category's grade, then each competency as a proficiency word
     with how many assignments it comes from, then how many competencies
     have evidence. Every value comes from calc.js. Kept in a map, not an
     attribute, so the HTML never round-trips through the DOM. */
  function _setNameTip(cid, student, sections) {
    var grade = studentGradeSummary(cid, student.id);
    var word = levelWord(cid, getOverallProficiency(cid, student.id));
    var tip =
      '<div class="gb-tip-head">Course Grade</div>' +
      '<div class="gb-tip-grade" style="color:' +
      (grade.text ? PROF_COLORS[grade.level] || PROF_COLORS[0] : 'var(--text-3)') +
      '">' +
      (grade.text ? (word ? word + ' (' + esc(grade.text) + ')' : esc(grade.text)) : 'No Evidence') +
      '</div>';
    // NS lowers only a percentage; a Proficiency class shows none.
    if (courseGradeMode(cid) !== 'proficiency') {
      var ns = getAssessments(cid).filter(function (a) {
        return getAssignmentStatus(cid, student.id, a.id) === 'NS';
      }).length;
      if (ns > 0)
        tip +=
          '<div class="gb-tip-note">' +
          ns +
          (ns === 1 ? ' assignment missing (counts as 0)' : ' assignments missing (count as 0)') +
          '</div>';
    }
    // Categories make up the course grade, so they sit under it, each graded
    // as the class shows grades.
    var cats = getCategories(cid) || [];
    if (cats.length) {
      var scoped = _scopedAssessments(cid);
      tip += '<div class="gb-tip-head">Categories</div>';
      cats.forEach(function (cat) {
        var g = assessmentGroupGrade(
          cid,
          student.id,
          scoped.filter(function (a) {
            return (a.categoryId || a.category_id || null) === cat.id;
          }),
          categoryCalcMode(cat),
        );
        tip +=
          '<div class="gb-tip-row"><span class="gb-tip-label">' +
          esc(cat.name) +
          '</span><span class="gb-tip-val" style="color:' +
          (g ? PROF_COLORS[g.level] || PROF_COLORS[0] : 'var(--text-3)') +
          '">' +
          (g ? esc(g.text) : '\u2014') +
          '</span></div>';
      });
    }
    // Each competency's level rests only on work handed in (an NS clears its
    // scores), so the group says how much work that is, and each row how
    // many assignments it comes from.
    var allIds = {};
    var rows = '';
    var withEvidence = 0;
    sections.forEach(function (sec) {
      var ids = {};
      sec.tags.forEach(function (t) {
        getCountedTagScores(cid, student.id, t.id).forEach(function (sc) {
          if (_isScoredEvidence(sc)) ids[sc.assessmentId] = allIds[sc.assessmentId] = true;
        });
      });
      var n = Object.keys(ids).length;
      var sp = getSectionProficiency(cid, student.id, sec.id);
      if (getSectionProficiencyRaw(cid, student.id, sec.id) > 0) withEvidence++;
      var r = Math.max(0, Math.min(4, Math.round(sp)));
      rows +=
        '<div class="gb-tip-row"><span class="gb-tip-label">' +
        esc(sec.shortName || sec.name) +
        '</span><span class="gb-tip-val" style="color:' +
        (r ? PROF_COLORS[r] : 'var(--text-3)') +
        '">' +
        PROF_LABELS[r] +
        (r && n ? ' <span class="gb-tip-count">(' + n + ')</span>' : '') +
        '</span></div>';
    });
    var handedIn = Object.keys(allIds).length;
    tip += '<div class="gb-tip-head">Competencies</div>';
    if (handedIn > 0)
      tip +=
        '<div class="gb-tip-note">From ' +
        handedIn +
        (handedIn === 1 ? ' assignment' : ' assignments') +
        ' handed in</div>';
    tip += rows;
    tip +=
      '<div class="gb-tip-note gb-tip-foot">Evidence in ' +
      withEvidence +
      ' of ' +
      sections.length +
      (sections.length === 1 ? ' competency' : ' competencies') +
      '</div>';
    _nameTipHtml[student.id] = tip;
  }

  /* ── Sorting ─────────────────────────────────────────────── */
  function applySorting(cid, students, sections, isLetter) {
    if (!sortCol) return students;
    var key = sortCol.key;
    var dir = sortCol.dir === 'asc' ? 1 : -1;
    return students.slice().sort(function (a, b) {
      var va, vb;
      if (key === 'name') {
        var af = (a.firstName || '').toLowerCase();
        var al = (a.lastName || '').toLowerCase();
        var bf = (b.firstName || '').toLowerCase();
        var bl = (b.lastName || '').toLowerCase();
        va = sortCol.by === 'first' ? af + ' ' + al : al + ' ' + af;
        vb = sortCol.by === 'first' ? bf + ' ' + bl : bl + ' ' + bf;
        return va < vb ? -dir : va > vb ? dir : 0;
      } else if (key === 'overall' && courseGradeMode(cid) === 'letter') {
        va = _getStudentLetterData(cid, a.id).R || 0;
        vb = _getStudentLetterData(cid, b.id).R || 0;
      } else if (key === 'overall') {
        va = getOverallProficiency(cid, a.id);
        vb = getOverallProficiency(cid, b.id);
      } else if (key === 'coverage') {
        va = getCompletionPct(cid, a.id);
        vb = getCompletionPct(cid, b.id);
      } else if (key === 'grade') {
        va = _getStudentLetterData(cid, a.id).R || 0;
        vb = _getStudentLetterData(cid, b.id).R || 0;
      } else if (key.startsWith('grp-')) {
        var grpId = key.slice(4);
        va = getGroupProficiency(cid, a.id, grpId);
        vb = getGroupProficiency(cid, b.id, grpId);
      } else if (key.startsWith('sec-')) {
        var secId = key.slice(4);
        va = getSectionProficiency(cid, a.id, secId);
        vb = getSectionProficiency(cid, b.id, secId);
      } else if (key.startsWith('avg-')) {
        var aid = key.slice(4);
        var sc = getScores(cid);
        var assess = getAssessments(cid).find(function (a) {
          return a.id === aid;
        });
        var tagIds = assess ? scoreTagIds(assess, cid) : [];
        var getAvg = function (sid) {
          var ss = sc[sid] || [];
          var ts = tagIds
            .map(function (tid) {
              var e = ss.find(function (e) {
                return e.assessmentId === aid && e.tagId === tid;
              });
              return e ? scoreModValue(e) : 0;
            })
            .filter(function (v) {
              return v > 0;
            });
          var rubricVal = getRubricAssessmentScore(cid, assess, ss);
          if (rubricVal !== undefined) return rubricVal || 0;
          return ts.length > 0
            ? ts.reduce(function (x, y) {
                return x + y;
              }, 0) / ts.length
            : 0;
        };
        va = getAvg(a.id);
        vb = getAvg(b.id);
      } else {
        va = getOverallProficiency(cid, a.id);
        vb = getOverallProficiency(cid, b.id);
      }
      return (va - vb) * dir;
    });
  }

  /* ── Complete / Incomplete cells ───────────────────────── */
  // Class Average for a points or Complete/Incomplete column: the average
  // points (or % complete), as the course % counts them.
  function _pointsAverageCell(cid, students, col, classes, wStyle) {
    var assess = getAssessments(cid).find(function (a) {
      return a.id === col.assessmentId;
    });
    var stats = assess ? getClassPointsAverage(cid, students, assess) : null;
    var open = '<td class="gb-score' + classes + '" style="' + wStyle + 'cursor:default">';
    if (!stats) return open + '<span class="gb-score-val s0" style="background:transparent">\u2014</span></td>';
    var r = pointsToProf(stats.pct, 100, getGradingScale(cid));
    var text = isCompletionScored(assess)
      ? Math.round(stats.pct) + '%'
      : formatPoints(Math.round(stats.avg * 10) / 10) + '/' + (assess.maxPoints || 100);
    return (
      open +
      '<span class="gb-avg-val" style="color:' +
      PROF_COLORS[r] +
      ';font-weight:700" title="' +
      stats.pct.toFixed(1) +
      '% across ' +
      stats.count +
      ' graded">' +
      text +
      '</span></td>'
    );
  }

  function completionCellHtml(mark) {
    if (mark === 'complete') return '<span class="gb-cmp gb-cmp-complete">\u2713</span>';
    if (mark === 'incomplete') return '<span class="gb-cmp gb-cmp-incomplete">\u2717</span>';
    return '<span class="gb-pts-empty">\u00B7</span>';
  }

  // Click order: unmarked → Complete → Incomplete → unmarked.
  function nextCompletionMark(mark) {
    return mark === 'complete' ? 'incomplete' : mark === 'incomplete' ? null : 'complete';
  }

  function setCellCompletion(td, mark) {
    var cid = activeCourse;
    var sid = td.dataset.sid;
    var aid = td.dataset.aid;
    var prevEntries = (getScores(cid)[sid] || [])
      .filter(function (e) {
        return e.assessmentId === aid;
      })
      .map(function (e) {
        return structuredClone(e);
      });
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var tagIds = assess ? scoreTagIds(assess, cid) : [];
    _undoStack.push({
      cid: cid,
      sid: sid,
      aid: aid,
      tagIds: tagIds,
      prevEntries: tagIds.map(function (tid) {
        return (
          prevEntries.find(function (e) {
            return e.tagId === tid;
          }) || null
        );
      }),
    });
    while (_undoStack.length > 50) _undoStack.shift();
    setCompletionMark(cid, sid, aid, mark);
    return _redrawCompetencyCell(td);
  }

  /* After an entry in the Competencies view: redraw from the saved data, so
     the student's Overall and the Class Average row follow, and give the
     grid's keyboard focus back to the same cell. Returns that cell. */
  function _redrawCompetencyCell(td) {
    var sel =
      '#gb-data td.gb-score[data-aid="' +
      CSS.escape(td.dataset.aid) +
      '"][data-sid="' +
      CSS.escape(td.dataset.sid) +
      '"]' +
      (td.dataset.tid ? '[data-tid="' + CSS.escape(td.dataset.tid) + '"]' : '[data-pts="1"]');
    clearProfCache();
    render();
    refreshSidebar();
    var cell = document.querySelector(sel);
    if (cell) cell.classList.add('gb-focus');
    return cell;
  }

  /* Remember the entries `keys` hold now, for Cmd+Z. */
  function _pushUndo(cid, sid, aid, keys) {
    var entries = getScores(cid)[sid] || [];
    _undoStack.push({
      cid: cid,
      sid: sid,
      aid: aid,
      tagIds: keys,
      prevEntries: keys.map(function (key) {
        var e = entries.find(function (x) {
          return x.assessmentId === aid && x.tagId === key;
        });
        return e ? structuredClone(e) : null;
      }),
    });
    while (_undoStack.length > 50) _undoStack.shift();
  }

  /* ── Score cycling ──────────────────────────────────────── */
  var seq = [3, 4, 0, 1, 2];
  /* The score keys a Competencies-view cell writes: its one key, or every
     key of its rubric criterion (data-tids) in Criteria mode. */
  function _cellScoreKeys(td) {
    var tids = (td.dataset.tids || '').split(',').filter(Boolean);
    return tids.length ? tids : [td.dataset.tid];
  }

  function cycleScore(td) {
    var cid = activeCourse;
    var aid = td.dataset.aid;
    var tid = td.dataset.tid;
    var sid = td.dataset.sid;
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    if (isCompletionScored(assess)) {
      setCellCompletion(td, nextCompletionMark(getCompletionMark(cid, sid, aid)));
      return;
    }
    if (assess && assess.scoreMode === 'points') {
      showPointsInput(td, assess);
      return;
    }
    var scores = getScores(cid);
    if (!scores[sid]) scores[sid] = [];
    var entry = scores[sid].find(function (e) {
      return e.assessmentId === aid && e.tagId === tid;
    });
    var current = entry ? entry.score : 0;
    var next = seq[(seq.indexOf(current) + 1) % seq.length];
    // A criterion cell (Rubric columns: Criteria) scores every competency
    // the criterion feeds, as the rubric scorer does.
    var tids = _cellScoreKeys(td);
    _undoStack.push({
      cid: cid,
      sid: sid,
      aid: aid,
      tagIds: tids,
      prevEntries: tids.map(function (key) {
        var e = scores[sid].find(function (x) {
          return x.assessmentId === aid && x.tagId === key;
        });
        return e ? structuredClone(e) : null;
      }),
    });
    while (_undoStack.length > 50) _undoStack.shift();
    // Use single-row upsert instead of full DELETE+INSERT bulk sync —
    // the bulk pattern is non-transactional and can lose data if INSERT
    // fails after DELETE succeeds.
    tids.forEach(function (key) {
      upsertScore(
        cid,
        sid,
        aid,
        key,
        next,
        assess ? assess.date : courseToday(cid),
        assess ? assess.type : 'summative',
      );
    });
    _redrawCompetencyCell(td);
  }

  // + / − on the focused cell's level; pressing the same key again clears it.
  function toggleCellMod(td, mod) {
    var cid = activeCourse;
    var aid = td.dataset.aid;
    var tid = td.dataset.tid;
    var sid = td.dataset.sid;
    if (!aid || !tid || !sid) return;
    var entry = (getScores(cid)[sid] || []).find(function (e) {
      return e.assessmentId === aid && e.tagId === tid;
    });
    if (!entry || !(entry.score > 0)) return;
    var current = normalizeScoreMod(entry.score, entry.mod);
    var next = current === mod ? 0 : mod;
    if (normalizeScoreMod(entry.score, next) !== next) return;
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var tids = _cellScoreKeys(td);
    var entries = getScores(cid)[sid] || [];
    _undoStack.push({
      cid: cid,
      sid: sid,
      aid: aid,
      tagIds: tids,
      prevEntries: tids.map(function (key) {
        var e = entries.find(function (x) {
          return x.assessmentId === aid && x.tagId === key;
        });
        return e ? structuredClone(e) : null;
      }),
    });
    while (_undoStack.length > 50) _undoStack.shift();
    var level = entry.score;
    tids.forEach(function (key) {
      upsertScore(
        cid,
        sid,
        aid,
        key,
        level,
        assess ? assess.date : courseToday(cid),
        assess ? assess.type : 'summative',
        entry.note || '',
        next,
      );
    });
    _redrawCompetencyCell(td);
  }

  /* ── Points-mode inline input ──────────────────────────── */
  function showPointsInput(td, assess) {
    if (td.querySelector('.gb-pts-input')) return;
    var cid = activeCourse;
    var aid = td.dataset.aid;
    var sid = td.dataset.sid;
    var isPtsCol = td.dataset.pts === '1';
    var max = assess.maxPoints || 100;
    var current = isPtsCol
      ? getPointsScore(cid, sid, aid)
      : (function () {
          var scores = getScores(cid);
          var entries = scores[sid] || [];
          var e = entries.find(function (e) {
            return e.assessmentId === aid && e.tagId === td.dataset.tid;
          });
          return e ? e.score : 0;
        })();
    var existing = td.querySelector('.gb-pts-display') || td.querySelector('.gb-pts-empty');
    if (existing) existing.style.display = 'none';
    var wrap = document.createElement('div');
    wrap.className = 'gb-pts-input-wrap';
    var inp = document.createElement('input');
    inp.type = 'number';
    inp.min = '0';
    inp.step = 'any';
    inp.max = String(max * POINTS_EXTRA_CREDIT_FACTOR);
    inp.inputMode = 'decimal';
    var hasCurrent = isPtsCol ? current != null : current > 0;
    inp.value = hasCurrent ? formatPoints(current) : '';
    inp.className = 'gb-pts-input';
    var pctLabel = document.createElement('span');
    pctLabel.className = 'gb-pts-live-pct';
    pctLabel.innerHTML = hasCurrent ? pointsPctHtml(current, max, 1) : '';
    wrap.appendChild(inp);
    wrap.appendChild(pctLabel);
    td.appendChild(wrap);
    inp.focus();
    inp.select();
    inp.addEventListener('input', function () {
      pctLabel.innerHTML = pointsPctHtml(parsePointsInput(inp.value, max), max, 1);
    });
    // Removing the input (Escape, or the redraw after a save) blurs it, and
    // blur commits; once is enough.
    var done = false;
    function commit() {
      if (done) return;
      done = true;
      var raw = parsePointsInput(inp.value, max);
      // Snapshot for undo
      var tagIds = isPtsCol ? scoreTagIds(assess, cid) : [td.dataset.tid];
      var prevEntries = tagIds.map(function (tid) {
        var e = (getScores(cid)[sid] || []).find(function (e) {
          return e.assessmentId === aid && e.tagId === tid;
        });
        return e ? structuredClone(e) : null;
      });
      _undoStack.push({ cid: cid, sid: sid, aid: aid, tagIds: tagIds, prevEntries: prevEntries });
      while (_undoStack.length > 50) _undoStack.shift();
      if (isPtsCol) {
        setPointsScore(cid, sid, aid, raw);
      } else {
        var tidVal = td.dataset.tid;
        upsertScore(cid, sid, aid, tidVal, raw || 0, assess.date || courseToday(cid), assess.type || 'summative');
      }
      _redrawCompetencyCell(td);
    }
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        done = true;
        wrap.remove();
        if (existing) existing.style.display = '';
      }
      e.stopPropagation();
    });
  }

  /* ── Scores tab: new assignment popover ──────────────────── */
  function dismissAddAssessPopover() {
    var existing = document.querySelector('.gb-add-popover');
    if (existing) existing.remove();
  }

  function showAddAssessPopover(anchor) {
    dismissAddAssessPopover();
    var cid = activeCourse;
    var sections = getSections(cid);
    var categories = _getSortedCategories(cid);
    var today = new Date().toISOString().slice(0, 10);

    var pop = document.createElement('div');
    pop.className = 'gb-add-popover';
    pop.innerHTML =
      '<div class="gb-add-popover-title">New Assignment</div>' +
      '<div class="gb-add-field"><label>Title</label><input type="text" id="gb-new-title" placeholder="e.g. Chapter 3 Quiz" autofocus></div>' +
      '<div class="gb-add-row">' +
      '<div class="gb-add-field"><label>Date</label><input type="date" id="gb-new-date" value="' +
      today +
      '"></div>' +
      // A class with categories needs one on every assessment, or the work
      // counts toward no letter grade (Schoology and Teams both require it).
      '<div class="gb-add-field"><label>Category</label><select id="gb-new-category">' +
      (categories.length === 0 ? '<option value="">No Category</option>' : '') +
      categories
        .map(function (category) {
          return '<option value="' + category.id + '">' + esc(category.name) + '</option>';
        })
        .join('') +
      '</select></div>' +
      '</div>' +
      '<div class="gb-add-row">' +
      '<div class="gb-add-field"><label>Score Mode</label><select id="gb-new-scoremode"><option value="proficiency">Proficiency (1-4)</option><option value="points">Points</option><option value="complete">Complete/Incomplete</option></select></div>' +
      '<div class="gb-add-field" id="gb-new-pts-wrap" style="display:none"><label>Max Points</label><input type="number" id="gb-new-maxpts" value="100" min="1"></div>' +
      '</div>' +
      (categories.length === 0
        ? '<div class="gb-add-field"><div style="font-size:0.875rem;color:var(--text-3)">No grading categories are configured for this course yet.</div></div>'
        : '') +
      '<div class="gb-add-field"><label>Standards <span style="font-weight:400;color:var(--text-3)">(optional)</span></label>' +
      '<div class="gb-add-tags">' +
      sections
        .map(function (sec) {
          return (
            '<label class="gb-add-tag"><input type="checkbox" value="' +
            (sec.tags[0] ? sec.tags[0].id : sec.id) +
            '" checked>' +
            '<span style="color:' +
            sec.color +
            '">' +
            esc(sec.shortName || sec.name) +
            '</span></label>'
          );
        })
        .join('') +
      '</div>' +
      '</div>' +
      '<div class="gb-add-actions">' +
      '<button class="gb-add-cancel" data-action="cancelAddAssess">Cancel</button>' +
      '<button class="gb-add-confirm" data-action="confirmAddAssess">Create</button>' +
      '</div>';
    document.body.appendChild(pop);

    // Show/hide points field
    var smSel = pop.querySelector('#gb-new-scoremode');
    smSel.addEventListener('change', function () {
      pop.querySelector('#gb-new-pts-wrap').style.display = smSel.value === 'points' ? '' : 'none';
    });

    // Position near button
    var rect = anchor.getBoundingClientRect();
    pop.style.top = rect.bottom + 8 + 'px';
    pop.style.right = window.innerWidth - rect.right + 'px';

    // Close on outside click (after a tick)
    setTimeout(function () {
      document.addEventListener('mousedown', function handler(ev) {
        if (!pop.contains(ev.target) && ev.target !== anchor) {
          dismissAddAssessPopover();
          document.removeEventListener('mousedown', handler);
        }
      });
    }, 0);

    // Focus title
    setTimeout(function () {
      var t = pop.querySelector('#gb-new-title');
      if (t) t.focus();
    }, 50);
  }

  function confirmAddAssess() {
    var cid = activeCourse;
    var title = (document.getElementById('gb-new-title') || {}).value;
    if (!title || !title.trim()) {
      var el = document.getElementById('gb-new-title');
      if (el) {
        el.style.border = '2px solid var(--score-1)';
        el.focus();
      }
      return;
    }
    var date = (document.getElementById('gb-new-date') || {}).value || new Date().toISOString().slice(0, 10);
    var categoryId = (document.getElementById('gb-new-category') || {}).value || '';
    var scoreMode = (document.getElementById('gb-new-scoremode') || {}).value || 'proficiency';
    var maxPoints = parseInt((document.getElementById('gb-new-maxpts') || {}).value, 10) || 100;
    var tagIds = Array.from(document.querySelectorAll('.gb-add-tag input:checked')).map(function (cb) {
      return cb.value;
    });

    var assessments = getAssessments(cid);
    var newAssess = {
      id: uid(),
      title: title.trim(),
      date: date,
      dateAssigned: date,
      type: 'summative',
      tagIds: tagIds,
      notes: '',
      created: new Date().toISOString(),
    };
    if (categoryId) {
      newAssess.categoryId = categoryId;
      newAssess.category_id = categoryId;
    }
    if (scoreMode === 'points') {
      newAssess.scoreMode = 'points';
      newAssess.maxPoints = maxPoints;
    } else if (scoreMode === 'complete') {
      newAssess.scoreMode = 'complete';
      newAssess.maxPoints = COMPLETE_MAX_POINTS;
    }
    assessments.push(newAssess);
    saveAssessments(cid, assessments);
    dismissAddAssessPopover();
    render();
  }

  /* ── Scores tab: CSV export ─────────────────────────────── */
  /* A score as the CSV prints it: what the Scores view shows, as plain text. */
  function _csvCellText(cell) {
    if (cell.kind === 'status') return cell.status;
    if (cell.kind === 'complete') return cell.mark === 'complete' ? 'Complete' : 'Incomplete';
    if (cell.kind === 'points') return formatPoints(cell.value);
    if (cell.kind === 'level') return formatLevelAs(null, cell.value, 'proficiency');
    if (cell.kind === 'missing' && cell.zero) return '0';
    if (cell.kind === 'dibels') return cell.dibels ? cell.text : '';
    return '';
  }

  /* A Class Average as the CSV prints it, the printed sheet's way. */
  function _csvAverageText(a, stats) {
    if (!stats) return '';
    if (isCompletionScored(a)) return Math.round(stats.pct) + '%';
    if (isPointsScored(a)) return formatPoints(Math.round(stats.avg * 10) / 10);
    return formatLevelAs(null, stats.avg, 'proficiency');
  }

  function exportScoresCSV() {
    var cid = activeCourse;
    var students = sortStudents(getStudents(cid), 'lastName');
    // The export matches the page: the chosen reporting term's assessments and grades.
    var term = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;
    var assessments = getAssessments(cid)
      .filter(function (a) {
        return !term || assessmentInActiveTerm(cid, a);
      })
      .sort(function (a, b) {
        return (b.date || '').localeCompare(a.date || '');
      });
    var sections = getSections(cid);
    var grouped = getGroupedSections(cid);
    var hasGroups = grouped.groups.some(function (g) {
      return g.sections.length > 0;
    });
    var isLetter = courseShowsLetterGrades(COURSES[cid]);

    // Build header
    var headers = ['Student'];
    if (hasGroups) {
      grouped.groups.forEach(function (gi) {
        if (gi.sections.length > 0) headers.push(gi.group.name + ' (Group Avg)');
      });
    }
    sections.forEach(function (sec) {
      headers.push(sec.shortName || sec.name);
    });
    headers.push('Overall', 'Final %');
    if (isLetter) headers.push('Grade');
    assessments.forEach(function (a) {
      headers.push(a.title + ' (' + (a.date || '') + ')');
    });

    var rows = [headers];
    students.forEach(function (s) {
      var row = [fullName(s)];
      // Group averages
      if (hasGroups) {
        grouped.groups.forEach(function (gi) {
          if (gi.sections.length === 0) return;
          var gp = getGroupProficiency(cid, s.id, gi.group.id);
          row.push(gp > 0 ? gp.toFixed(2) : '');
        });
      }
      // Individual sections
      sections.forEach(function (sec) {
        var sp = getSectionProficiency(cid, s.id, sec.id);
        row.push(sp > 0 ? sp.toFixed(2) : '');
      });
      // Overall + final %
      var overall = getOverallProficiency(cid, s.id);
      var letterData = _getStudentLetterData(cid, s.id);
      row.push(overall > 0 ? overall.toFixed(2) : '');
      row.push(
        _getDisplayedFinalPercent(cid, s.id) != null ? _getDisplayedFinalPercent(cid, s.id).toFixed(1) + '%' : '',
      );
      if (isLetter) row.push(letterData.S ? letterData.S + ' (' + letterData.R + '%)' : '');
      // Assessment scores, as the Scores view shows them (calc.js)
      assessments.forEach(function (a) {
        row.push(_csvCellText(assessmentCellValue(cid, s.id, a)));
      });
      rows.push(row);
    });
    // Class Average under each assessment, by calc.js's one column rule
    var avgRow = ['Class Average'];
    for (var pad = 1; pad < headers.length - assessments.length; pad++) avgRow.push('');
    assessments.forEach(function (a) {
      avgRow.push(_csvAverageText(a, classColumnAverage(cid, students, { assessment: a })));
    });
    rows.push(avgRow);

    var csv = rows
      .map(function (r) {
        return r
          .map(function (c) {
            return '"' + String(c).replace(/"/g, '""') + '"';
          })
          .join(',');
      })
      .join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download =
      (COURSES[cid] ? COURSES[cid].name : 'gradebook') +
      (term ? '_' + String(term.label || 'term').replace(/[^\w-]+/g, '_') : '') +
      '_scores.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ── Scores tab: context menus ──────────────────────────── */
  /* Opens a right-click menu at the pointer, flipped up or left when it
     would run past the bottom or right edge of the window. */
  function _placeContextMenu(menu, x, y) {
    document.body.appendChild(menu);
    var w = menu.offsetWidth;
    var h = menu.offsetHeight;
    if (x + w > window.innerWidth - 8) x = Math.max(8, x - w);
    if (y + h > window.innerHeight - 8) y = Math.max(8, y - h);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  }

  function _dismissContextMenu() {
    var existing = document.querySelector('.gb-ctx-menu');
    if (existing) existing.remove();
  }

  function showScoreContextMenu(e, cell) {
    _dismissContextMenu();
    var aid = cell.dataset.aid;
    var sid = cell.dataset.sid;
    var status = getAssignmentStatus(activeCourse, sid, aid);
    // Missing and Excused never go on work with a score or feedback.
    function statusItem(ctx, key, label) {
      var locked = !canSetAssignmentStatus(activeCourse, sid, aid, key);
      return (
        '<div class="gb-ctx-item' +
        (locked ? ' is-disabled" aria-disabled="true" title="This student has a score or feedback on this work.' : '') +
        '" data-ctx="' +
        ctx +
        '">' +
        label +
        '</div>'
      );
    }
    var menu = document.createElement('div');
    menu.className = 'gb-ctx-menu';
    menu.innerHTML =
      '<div class="gb-ctx-item" data-ctx="editCell">Edit score</div>' +
      '<div class="gb-ctx-item" data-ctx="clearCell">Clear score</div>' +
      '<div class="gb-ctx-divider"></div>' +
      statusItem('markMissing', 'NS', status === 'NS' ? 'Undo missing' : 'Mark missing') +
      statusItem('excuseCell', 'EXC', status === 'EXC' ? 'Undo excuse' : 'Excuse') +
      '<div class="gb-ctx-divider"></div>' +
      '<div class="gb-ctx-item" data-ctx="addObservation">Add observation</div>';
    _placeContextMenu(menu, e.clientX, e.clientY);
    menu.addEventListener('click', function (ev) {
      var item = ev.target.closest('[data-ctx]');
      if (!item || item.classList.contains('is-disabled')) return;
      var action = item.dataset.ctx;
      if (action === 'editCell') startCellEdit(cell);
      else if (action === 'addObservation') openObservationDialog(sid, aid);
      else if (action === 'clearCell') {
        var cid = activeCourse;
        var scores = getScores(cid);
        var assess = getAssessments(cid).find(function (a) {
          return a.id === aid;
        });
        if (assess && scores[sid]) {
          scoreTagIds(assess, cid).forEach(function (tid) {
            var idx = scores[sid].findIndex(function (e) {
              return e.assessmentId === aid && e.tagId === tid;
            });
            if (idx >= 0) scores[sid].splice(idx, 1);
          });
          saveScores(cid, scores);
          clearProfCache();
          render();
          window.clearScore(sid, aid);
        }
      } else if (action === 'markMissing' || action === 'excuseCell') {
        // Same path as the Assignments page's NS / EXC buttons; picking the
        // cell's current status again takes it off.
        var next = action === 'markMissing' ? 'NS' : 'EXC';
        applyAssignmentStatus(activeCourse, sid, aid, status === next ? null : next);
        clearProfCache();
        render();
      }
      _dismissContextMenu();
    });
    setTimeout(function () {
      document.addEventListener('click', _dismissContextMenu, { once: true });
    }, 0);
  }

  /* The shared capture strip in a dialog, with this cell's student and
     assessment fixed. */
  function openObservationDialog(sid, aid) {
    var cid = activeCourse;
    var student = getStudents(cid).find(function (s) {
      return s.id === sid;
    });
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    if (!student || !assess) return;
    ObsCapture.openDialog({
      cid: cid,
      title: 'Add observation',
      subtitle: displayName(student) + ' \u00b7 ' + (assess.title || 'Assessment'),
      students: [sid],
      lockStudents: true,
      assessmentId: aid,
      lockAssessment: true,
      draftKey: 'gb-cell|' + sid + '|' + aid,
    });
  }

  /* The cells Count Missing as Zero / as Excused set in one column, kept on
     this device so Undo Count Missing can take them off again. */
  function _bulkStatusUndo(cid, aid) {
    try {
      return JSON.parse(localStorage.getItem('gb_bulkStatus_' + cid + '_' + aid)) || [];
    } catch (e) {
      return [];
    }
  }
  function _saveBulkStatusUndo(cid, aid, list) {
    try {
      if (list.length) localStorage.setItem('gb_bulkStatus_' + cid + '_' + aid, JSON.stringify(list));
      else localStorage.removeItem('gb_bulkStatus_' + cid + '_' + aid);
    } catch (e) {}
  }

  function showHeaderContextMenu(e, header) {
    _dismissContextMenu();
    var aid = header.dataset.aid;
    var menu = document.createElement('div');
    menu.className = 'gb-ctx-menu';
    var assess = getAssessments(activeCourse).find(function (a) {
      return a.id === aid;
    });
    menu.innerHTML =
      '<div class="gb-ctx-item" data-ctx="scoreMode">Score This Assignment</div>' +
      '<div class="gb-ctx-item" data-ctx="editAssess">Edit Assignment Details</div>' +
      '<div class="gb-ctx-divider"></div>' +
      '<div class="gb-ctx-item" data-ctx="markUngradedNS">Count Missing as Zero</div>' +
      '<div class="gb-ctx-item" data-ctx="markUngradedEXC">Count Missing as Excused</div>' +
      (_bulkStatusUndo(activeCourse, aid).length
        ? '<div class="gb-ctx-item" data-ctx="undoBulkStatus">Undo Count Missing</div>'
        : '') +
      '<div class="gb-ctx-divider"></div>' +
      '<div class="gb-ctx-item gb-ctx-danger" data-ctx="deleteAssess">Delete Assignment</div>';
    _placeContextMenu(menu, e.clientX, e.clientY);
    menu.addEventListener('click', function (ev) {
      var item = ev.target.closest('[data-ctx]');
      if (!item) return;
      var action = item.dataset.ctx;
      if (action === 'scoreMode') {
        // The grader opens on the top student in the order shown.
        var firstRow = document.querySelector('.gb-scores-row[data-sid]');
        if (firstRow) openGrader(firstRow.dataset.sid, aid);
      } else if (action === 'editAssess') Router.navigate('/assignments?course=' + activeCourse + '&edit=' + aid);
      else if (action === 'markUngradedNS' || action === 'markUngradedEXC') {
        // Every student row on screen with nothing in this column (no score,
        // no mark, no status) becomes NS (counted as 0) or EXC.
        if (assess) {
          var next = action === 'markUngradedNS' ? 'NS' : 'EXC';
          var statuses = getAssignmentStatuses(activeCourse);
          var undo = _bulkStatusUndo(activeCourse, aid);
          var changed = false;
          document.querySelectorAll('.gb-scores-row[data-sid]').forEach(function (row) {
            var sid = row.dataset.sid;
            var cell = assessmentCellValue(activeCourse, sid, assess);
            if (
              (cell.kind === 'none' || cell.kind === 'missing') &&
              !cell.status &&
              canSetAssignmentStatus(activeCourse, sid, aid, next)
            ) {
              statuses[sid + ':' + aid] = next;
              undo.push({ sid: sid, status: next });
              changed = true;
            }
          });
          if (changed) {
            saveAssignmentStatuses(activeCourse, statuses);
            _saveBulkStatusUndo(activeCourse, aid, undo);
            clearProfCache();
            render();
          }
        }
      } else if (action === 'undoBulkStatus') {
        // Takes off only the NS / EXC the bulk items set, and only where the
        // cell still holds that status.
        var st = getAssignmentStatuses(activeCourse);
        _bulkStatusUndo(activeCourse, aid).forEach(function (u) {
          var key = u.sid + ':' + aid;
          if (st[key] === u.status) delete st[key];
        });
        saveAssignmentStatuses(activeCourse, st);
        _saveBulkStatusUndo(activeCourse, aid, []);
        clearProfCache();
        render();
      } else if (action === 'deleteAssess') {
        // P7.8: replace native confirm with the in-app dialog so the dialog
        // can spell out irreversibility and stay consistent with other
        // destructive actions in the gradebook.
        // The dialog names the assignment so a click on the wrong column is
        // caught before anything happens.
        var title = assess && assess.title ? assess.title : 'this assignment';
        showConfirm(
          'Delete “' + title + '”?',
          'All scores, statuses, and observations linked to this assignment will be removed. You can undo this for a few seconds.',
          'Delete',
          'danger',
          function () {
            _deleteAssessWithUndo(activeCourse, aid, title);
          },
        );
      }
      _dismissContextMenu();
    });
    setTimeout(function () {
      document.addEventListener('click', _dismissContextMenu, { once: true });
    }, 0);
  }

  /* Delete Assignment hides the column and offers Undo (the toast's button or
     Cmd/Ctrl+Z). The delete reaches the data layer only when the toast closes
     without Undo: it times out, another toast replaces it, or the page is left. */
  var _pendingDeleteAids = {}; // aid → cid, hidden until the Undo window closes
  var DELETE_UNDO_MS = 10000;
  var _mounted = false;

  function _deleteAssessWithUndo(cid, aid, title) {
    if (_pendingDeleteAids[aid]) return;
    _pendingDeleteAids[aid] = cid;
    render();
    var settled = false;
    showUndoToast(
      'Deleted “' + title + '”',
      function () {
        if (settled) return;
        settled = true;
        delete _pendingDeleteAids[aid];
        if (_mounted && activeCourse === cid) render();
      },
      function () {
        if (settled) return;
        settled = true;
        delete _pendingDeleteAids[aid];
        _commitDeleteAssess(cid, aid);
        if (_mounted && activeCourse === cid) render();
      },
      DELETE_UNDO_MS,
    );
  }

  // Closing the tab inside the undo window still deletes.
  if (typeof window.addEventListener === 'function')
    window.addEventListener('pagehide', function () {
      if (Object.keys(_pendingDeleteAids).length && typeof dismissUndoToast === 'function') dismissUndoToast();
    });

  function _commitDeleteAssess(cid, aid) {
    var assessments = getAssessments(cid).filter(function (a) {
      return a.id !== aid;
    });
    saveAssessments(cid, assessments);
    var scores = getScores(cid);
    Object.keys(scores).forEach(function (sid) {
      scores[sid] = scores[sid].filter(function (e) {
        return e.assessmentId !== aid;
      });
    });
    saveScores(cid, scores);
    // P6.5: previously this branch only cleaned scores+assessments,
    // leaving status pills + observations orphaned in LS and on the
    // server. Mirror page-assignments.js's deleteAssess so the two
    // delete entry points produce the same canonical end state.
    var statuses = getAssignmentStatuses(cid);
    var statusChanged = false;
    Object.keys(statuses).forEach(function (k) {
      if (k.endsWith(':' + aid)) {
        delete statuses[k];
        statusChanged = true;
      }
    });
    if (statusChanged) saveAssignmentStatuses(cid, statuses);
    deleteAssessmentObservations(cid, aid);
    clearProfCache();
  }

  /* ── Scores tab: column-focus score mode ────────────────── */
  function enterScoreMode(assessmentId) {
    _scoreMode = { assessmentId: assessmentId, studentIdx: 0 };
    render();
    setTimeout(function () {
      var firstCell = document.querySelector('.gb-scores-cell.gb-scores-focus');
      if (firstCell) startCellEdit(firstCell);
    }, 50);
    // Click anywhere outside the active column exits score mode
    setTimeout(function () {
      document.addEventListener('mousedown', _scoreModeClickAway);
    }, 100);
  }

  function _scoreModeClickAway(e) {
    if (!_scoreMode) {
      document.removeEventListener('mousedown', _scoreModeClickAway);
      return;
    }
    // If clicking a cell in the same column, stay in score mode
    var cell = e.target.closest('.gb-scores-cell');
    if (cell && cell.dataset.aid === _scoreMode.assessmentId) return;
    // Clicking anywhere else exits score mode
    _flushActiveScoreEditor();
    exitScoreMode();
  }

  function exitScoreMode() {
    _scoreMode = null;
    document.removeEventListener('mousedown', _scoreModeClickAway);
    render();
  }

  function advanceScoreMode() {
    if (!_scoreMode) return;
    _scoreMode.studentIdx++;
    render();
    setTimeout(function () {
      var target = document.querySelector('.gb-scores-cell.gb-scores-focus');
      if (target) startCellEdit(target);
      // If no focus cell found (past last student), just stay in column mode
      // User clicks away to exit
    }, 50);
  }

  /* ── Scores tab: inline cell editing ────────────────────── */
  /* Clicking a score opens the Assignments page's grader for that student
     and assessment in a dialog: the rubric, Complete/Incomplete, points or
     levels, whichever the work uses. Previous/Next steps through the rows
     in the order shown; closing redraws the gradebook. While it is open the
     gradebook's own listeners stand aside (_graderOpen). */
  function openGrader(sid, aid) {
    if (!window.PageAssignments || !sid || !aid) return;
    var ids = Array.prototype.map.call(document.querySelectorAll('.gb-scores-row[data-sid]'), function (row) {
      return row.dataset.sid;
    });
    _hideTip();
    PageAssignments.openGrader(activeCourse, aid, sid, {
      studentIds: ids,
      onClose: function () {
        clearProfCache();
        render();
      },
    });
  }
  function _graderOpen() {
    return !!(window.PageAssignments && PageAssignments.graderOpen());
  }

  function startCellEdit(td) {
    if (td.querySelector('.gb-scores-input')) return;
    var cid = activeCourse;
    var aid = td.dataset.aid;
    var sid = td.dataset.sid;
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    if (!assess) return;
    if (isCompletionScored(assess)) {
      setCompletionMark(cid, sid, aid, nextCompletionMark(getCompletionMark(cid, sid, aid)));
      clearProfCache();
      render();
      return;
    }
    var tagIds = scoreTagIds(assess, cid);
    var studentScores = getScores(cid)[sid] || [];
    // Get current average for display
    var tagScores = tagIds
      .map(function (tid) {
        var e = studentScores.find(function (e) {
          return e.assessmentId === aid && e.tagId === tid;
        });
        return e ? scoreModValue(e) : 0;
      })
      .filter(function (v) {
        return v > 0;
      });
    var currentVal =
      tagScores.length > 0
        ? tagScores.reduce(function (a, b) {
            return a + b;
          }, 0) / tagScores.length
        : 0;

    // A points assessment is edited as its points (33.5 of 40), not a level.
    var isPts = isPointsScored(assess);
    var maxPts = assess.maxPoints || 100;
    var span = td.querySelector('.gb-scores-val');
    if (span) span.style.display = 'none';
    var inp = document.createElement('input');
    inp.type = 'number';
    inp.step = isPts ? 'any' : '0.1';
    inp.min = '0';
    inp.max = isPts ? String(maxPts * POINTS_EXTRA_CREDIT_FACTOR) : '4';
    if (isPts) inp.inputMode = 'decimal';
    inp.className = 'gb-scores-input';
    var currentPts = isPts ? getPointsScore(cid, sid, aid) : null;
    if (isPts) inp.value = currentPts != null ? formatPoints(currentPts) : '';
    else inp.value = currentVal > 0 ? currentVal.toFixed(1) : '';
    td.appendChild(inp);
    inp.focus();
    inp.select();
    // What the cell opened with. A Scores cell shows one value for the whole
    // assessment (the average of its competencies), so writing it back
    // unchanged would flatten each competency's own score and +/−.
    var openedValue = inp.value;

    function save() {
      var val = isPts ? parsePointsInput(inp.value, maxPts) : parseFloat(inp.value);
      // Blank clears: null for points (where 0 is a score), 0 for levels.
      if (!isPts && (inp.value === '' || isNaN(val))) val = 0;
      // Save undo
      // Save full entries for undo (deep copy)
      var prevEntries = tagIds.map(function (tid) {
        var e = (getScores(cid)[sid] || []).find(function (e) {
          return e.assessmentId === aid && e.tagId === tid;
        });
        return e ? structuredClone(e) : null;
      });
      _undoStack.push({ cid: cid, sid: sid, aid: aid, tagIds: tagIds, prevEntries: prevEntries });
      while (_undoStack.length > 50) _undoStack.shift();
      // Apply score to all tags in this assessment. A save this device
      // couldn't keep shows on the sync dot (data.js), not here.
      if (isPts) {
        // One value for the whole assessment, mirrored onto each competency.
        setPointsScore(cid, sid, aid, val);
      } else {
        tagIds.forEach(function (tid) {
          upsertScore(cid, sid, aid, tid, val, assess.date || courseToday(cid), assess.type || 'summative', '');
        });
      }
    }

    function commit(navDir) {
      if (inp.value !== openedValue) save();
      clearProfCache();
      inp.remove();
      if (span) span.style.display = '';
      if (_scoreMode) {
        advanceScoreMode();
        return;
      }
      // Navigate to adjacent cell
      if (navDir) {
        // Capture data attributes BEFORE re-render destroys DOM
        var row = td.closest('tr');
        var cells = Array.from(row.querySelectorAll('.gb-scores-cell'));
        var colIdx = cells.indexOf(td);
        var rows = Array.from(document.querySelectorAll('.gb-scores-row'));
        var rowIdx = rows.indexOf(row);
        var targetAid = null,
          targetSid = null;
        if (navDir === 'right' && colIdx < cells.length - 1) {
          targetAid = cells[colIdx + 1].dataset.aid;
          targetSid = cells[colIdx + 1].dataset.sid;
        } else if (navDir === 'left' && colIdx > 0) {
          targetAid = cells[colIdx - 1].dataset.aid;
          targetSid = cells[colIdx - 1].dataset.sid;
        } else if (navDir === 'down' && rowIdx < rows.length - 1) {
          var nextCells = rows[rowIdx + 1].querySelectorAll('.gb-scores-cell');
          if (nextCells[colIdx]) {
            targetAid = nextCells[colIdx].dataset.aid;
            targetSid = nextCells[colIdx].dataset.sid;
          }
        }
        if (targetAid && targetSid) {
          render();
          setTimeout(function () {
            var newCell = document.querySelector(
              '.gb-scores-cell[data-aid="' + targetAid + '"][data-sid="' + targetSid + '"]',
            );
            if (newCell) startCellEdit(newCell);
          }, 30);
          return;
        }
      }
      render();
    }

    var _navDir = null; // 'down' | 'right' | null
    var _cancelled = false; // Escape: removing the input blurs it, and blur saves
    inp.addEventListener('blur', function () {
      if (_cancelled) return;
      commit(_navDir);
    });
    inp.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        _navDir = 'down';
        inp.blur();
      } else if (ev.key === 'Tab') {
        ev.preventDefault();
        _navDir = ev.shiftKey ? 'left' : 'right';
        inp.blur();
      } else if (ev.key === 'Escape') {
        _cancelled = true;
        inp.remove();
        if (span) span.style.display = '';
        exitScoreMode();
      }
    });
  }

  /* ── Keyboard Navigation ────────────────────────────────── */
  function kbAdvanceDown(table, focused) {
    var rows = table.querySelectorAll('tbody tr:not(.gb-stats-row)');
    var colsPerRow = rows[0] ? rows[0].querySelectorAll('td.gb-score').length : 0;
    if (colsPerRow === 0) return;
    var curRow = -1,
      curCol = -1;
    rows.forEach(function (r, ri) {
      r.querySelectorAll('td.gb-score').forEach(function (c, ci) {
        if (c === focused) {
          curRow = ri;
          curCol = ci;
        }
      });
    });
    if (curRow < 0) return;
    var newRow = Math.min(curRow + 1, rows.length - 1);
    if (newRow === curRow) return;
    focused.classList.remove('gb-focus');
    var newCell = rows[newRow] ? rows[newRow].querySelectorAll('td.gb-score')[curCol] : null;
    if (newCell) {
      newCell.classList.add('gb-focus');
      newCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function _handleKeydown(e) {
    if (_graderOpen()) return;
    // Escape closes a tooltip first (WCAG 1.4.13: dismissible without moving).
    if (e.key === 'Escape' && _tipSource) _hideTip();
    // Cmd+Z undoes the last score in either view; in a text field it stays
    // the field's own undo.
    var inTextField =
      e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable === true;
    // While a deleted assignment can still be brought back, Cmd+Z does that first.
    if (
      (e.metaKey || e.ctrlKey) &&
      e.key === 'z' &&
      !e.shiftKey &&
      !inTextField &&
      Object.keys(_pendingDeleteAids).length &&
      typeof executeUndo === 'function'
    ) {
      e.preventDefault();
      executeUndo();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey && !inTextField && _undoStack.length > 0) {
      e.preventDefault();
      var undo = _undoStack.pop();
      var scores = getScores(undo.cid);
      if (!scores[undo.sid]) scores[undo.sid] = [];
      var beforeScores = structuredClone(scores);
      // Restore previous entries (full objects)
      (undo.tagIds || []).forEach(function (tid, i) {
        var prevEntry = undo.prevEntries[i];
        // Remove current entry for this tag
        var idx = scores[undo.sid].findIndex(function (e) {
          return e.assessmentId === undo.aid && e.tagId === tid;
        });
        if (idx >= 0) scores[undo.sid].splice(idx, 1);
        // Restore previous entry if it existed
        if (prevEntry) scores[undo.sid].push(prevEntry);
      });
      saveScores(undo.cid, scores);
      persistScoreDiffToCanonical(undo.cid, beforeScores, scores);
      clearProfCache();
      render();
      return;
    }
    if (viewMode !== 'detailed') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    // Keys on a focused link or button (a student's name, the toolbar) are
    // theirs: Tab moves on and Enter follows the link, not the grid.
    if (e.target.closest && e.target.closest('a[data-href], button')) return;
    var table = document.querySelector('.gb-table');
    if (!table) return;
    var rows = table.querySelectorAll('tbody tr:not(.gb-stats-row)');
    if (rows.length === 0) return;
    var colsPerRow = rows[0].querySelectorAll('td.gb-score').length;
    if (colsPerRow === 0) return;
    var focused = table.querySelector('.gb-focus');
    if (!focused && !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab'].includes(e.key)) return;
    if (!focused && ['ArrowDown', 'ArrowRight', 'Tab'].includes(e.key)) {
      e.preventDefault();
      var first = rows[0] ? rows[0].querySelector('td.gb-score') : null;
      if (first) {
        first.classList.add('gb-focus');
        first.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      return;
    }
    if (!focused) return;
    var curRow = -1,
      curCol = -1;
    rows.forEach(function (r, ri) {
      r.querySelectorAll('td.gb-score').forEach(function (c, ci) {
        if (c === focused) {
          curRow = ri;
          curCol = ci;
        }
      });
    });
    if (curRow < 0) return;
    var newRow = curRow,
      newCol = curCol;
    if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      newCol++;
      if (newCol >= colsPerRow) {
        newCol = 0;
        newRow++;
      }
      if (newRow >= rows.length) {
        newRow = rows.length - 1;
        newCol = colsPerRow - 1;
      }
    } else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      newCol--;
      if (newCol < 0) {
        newCol = colsPerRow - 1;
        newRow--;
      }
      if (newRow < 0) {
        newRow = 0;
        newCol = 0;
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      newRow = Math.min(curRow + 1, rows.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      newRow = Math.max(curRow - 1, 0);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      focused.click();
      return;
    } else if (e.key === 'Escape') {
      focused.classList.remove('gb-focus');
      return;
    } else if (
      focused.dataset.action !== 'cycleScore' &&
      (['+', '=', '-', '_', 'Backspace', 'Delete'].includes(e.key) || /^[0-9]$/.test(e.key))
    ) {
      // A cell with no action (a competency of rubric work) is read-only:
      // it is scored on the rubric in Assignments.
      e.preventDefault();
      return;
    } else if (['+', '=', '-', '_'].includes(e.key)) {
      e.preventDefault();
      if (focused.dataset.pts !== '1') toggleCellMod(focused, e.key === '+' || e.key === '=' ? 1 : -1);
      return;
    } else if (focused.dataset.cmp === '1' && ['c', 'C', '1', 'i', 'I', 'x', 'X'].includes(e.key)) {
      // Complete/Incomplete cell: C or 1 marks Complete, I or X marks Incomplete.
      e.preventDefault();
      var marked = setCellCompletion(focused, ['c', 'C', '1'].includes(e.key) ? 'complete' : 'incomplete');
      if (marked) kbAdvanceDown(document.querySelector('.gb-table'), marked);
      return;
    } else if (['1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(e.key)) {
      var ptsAssess = focused.dataset.aid
        ? getAssessments(activeCourse).find(function (a) {
            return a.id === focused.dataset.aid;
          })
        : null;
      if (ptsAssess && ptsAssess.scoreMode === 'points') {
        e.preventDefault();
        showPointsInput(focused, ptsAssess);
        var pi = focused.querySelector('.gb-pts-input');
        if (pi) {
          pi.value = e.key;
          pi.dispatchEvent(new Event('input'));
        }
        return;
      }
      if (!['1', '2', '3', '4'].includes(e.key)) return;
      e.preventDefault();
      var val = parseInt(e.key, 10);
      var aid = focused.dataset.aid;
      var tid = focused.dataset.tid;
      var sid = focused.dataset.sid;
      if (aid && tid && sid) {
        var assess = getAssessments(activeCourse).find(function (a) {
          return a.id === aid;
        });
        // Every key the cell writes, as a click does (a criterion's
        // competencies in Criteria mode).
        var keys = _cellScoreKeys(focused);
        _pushUndo(activeCourse, sid, aid, keys);
        keys.forEach(function (key) {
          upsertScore(
            activeCourse,
            sid,
            aid,
            key,
            val,
            assess ? assess.date : courseToday(activeCourse),
            assess ? assess.type : 'summative',
            '',
          );
        });
        focused = _redrawCompetencyCell(focused);
        table = document.querySelector('.gb-table');
      }
      if (focused && table) kbAdvanceDown(table, focused);
      return;
    } else if (e.key === '0' || e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      var aid = focused.dataset.aid;
      var tid = focused.dataset.tid;
      var sid = focused.dataset.sid;
      if (aid && sid && focused.dataset.cmp === '1') {
        setCellCompletion(focused, null);
        return;
      }
      if (aid && sid) {
        var assess = getAssessments(activeCourse).find(function (a) {
          return a.id === aid;
        });
        if (focused.dataset.pts === '1') {
          _pushUndo(activeCourse, sid, aid, assess ? scoreTagIds(assess, activeCourse) : []);
          setPointsScore(activeCourse, sid, aid, null);
        } else if (tid) {
          var clearKeys = _cellScoreKeys(focused);
          _pushUndo(activeCourse, sid, aid, clearKeys);
          clearKeys.forEach(function (key) {
            upsertScore(
              activeCourse,
              sid,
              aid,
              key,
              0,
              assess ? assess.date : courseToday(activeCourse),
              assess ? assess.type : 'summative',
              '',
            );
          });
        }
        _redrawCompetencyCell(focused);
      }
      return;
    } else return;
    focused.classList.remove('gb-focus');
    var newCell = rows[newRow] ? rows[newRow].querySelectorAll('td.gb-score')[newCol] : null;
    if (newCell) {
      newCell.classList.add('gb-focus');
      newCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  /* ── Tooltip ─────────────────────────────────────────────── */
  function _handleMouseover(e) {
    if (_graderOpen()) return;
    var name = e.target.closest('.gb-grid-rowhead-name');
    if (name) {
      _showNameTip(name);
      return;
    }
    var assessGroup = e.target.closest('.gb-grid-assess-group');
    if (assessGroup) _showAssessTitleTip(assessGroup);
  }

  /* Beside the name, or below it when there's no room to the right. */
  function _showNameTip(name) {
    var gbTip = document.getElementById('gb-tooltip');
    var tipHtml = name.dataset.sid ? _nameTipHtml[name.dataset.sid] : null;
    if (!gbTip || !tipHtml) return;
    gbTip.className = '';
    gbTip.innerHTML = tipHtml;
    gbTip.style.display = 'block';
    _tipSource = name;
    var rect = name.getBoundingClientRect();
    var left = rect.right + 8;
    var top = rect.top + rect.height / 2 - gbTip.offsetHeight / 2;
    if (left + gbTip.offsetWidth > window.innerWidth - 12) {
      left = rect.left;
      top = rect.bottom + 6;
    }
    if (top < 8) top = 8;
    if (top + gbTip.offsetHeight > window.innerHeight - 8) top = window.innerHeight - gbTip.offsetHeight - 8;
    gbTip.style.left = left + 'px';
    gbTip.style.top = top + 'px';
  }

  /* A Competencies-view header clamps its title to two lines; hovering the
     header or focusing its link shows the whole title. */
  function _showAssessTitleTip(group) {
    var gbTip = document.getElementById('gb-tooltip');
    var link = group.querySelector('.gb-assess-title');
    if (!gbTip || !link || link.scrollHeight <= link.clientHeight + 1) return;
    gbTip.className = 'dark';
    gbTip.textContent = link.textContent;
    gbTip.style.display = 'block';
    _tipSource = group;
    var rect = group.getBoundingClientRect();
    var left = rect.left + rect.width / 2 - gbTip.offsetWidth / 2;
    if (left < 8) left = 8;
    if (left + gbTip.offsetWidth > window.innerWidth - 8) left = window.innerWidth - gbTip.offsetWidth - 8;
    gbTip.style.left = left + 'px';
    gbTip.style.top = rect.bottom + 6 + 'px';
  }

  function _hideTip() {
    var gbTip = document.getElementById('gb-tooltip');
    if (gbTip) {
      gbTip.style.display = 'none';
      gbTip.className = '';
    }
    _tipSource = null;
  }

  function _handleFocusin(e) {
    if (_graderOpen()) return;
    if (!e.target.closest) return;
    var name = e.target.closest('.gb-grid-rowhead-name');
    if (name) {
      _showNameTip(name);
      return;
    }
    var link = e.target.closest('.gb-grid-assess-group .gb-assess-title');
    if (link) _showAssessTitleTip(link.closest('.gb-grid-assess-group'));
  }

  function _handleFocusout(e) {
    if (_tipSource && _tipSource.contains(e.target)) _hideTip();
  }

  function _handleMouseout(e) {
    if (_tipSource) {
      var related = e.relatedTarget;
      if (!related || !_tipSource.contains(related)) _hideTip();
    }
  }

  /* ── Delegated click handler ──────────────────────────────── */
  function _handleClick(e) {
    if (_graderOpen()) return;
    // Click-to-focus for score cells
    var td = e.target.closest('td.gb-score');
    var table = document.querySelector('.gb-table');
    if (td && table) {
      table.querySelectorAll('.gb-focus').forEach(function (el) {
        el.classList.remove('gb-focus');
      });
      td.classList.add('gb-focus');
    } else if (table && !e.target.closest('td.gb-score')) {
      table.querySelectorAll('.gb-focus').forEach(function (el) {
        el.classList.remove('gb-focus');
      });
    }

    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.dataset.action;
    if (el.dataset.stopProp === 'true') e.stopPropagation();
    var handlers = {
      setView: function () {
        setView(el.dataset.mode);
      },
      toggleNewestFirst: toggleNewestFirst,
      toggleFilterStrip: function () {
        toggleFilterStrip();
      },
      clearStudentFilter: function () {
        filterStudentIds = [];
        // Drop ?students= from the address so a reload shows everyone too.
        Router.setUrl('/gradebook?course=' + activeCourse);
        render();
      },
      toggleCategoryFilter: function () {
        toggleCategoryFilter(el.dataset.catid);
      },
      toggleSectionFilter: function () {
        toggleSectionFilter(el.dataset.secid);
      },
      toggleModuleFilter: function () {
        toggleModuleFilter(el.dataset.moduleid);
      },
      clearAllFilters: function () {
        clearAllFilters();
      },
      toggleSort: function () {
        toggleSort(el.dataset.sortkey);
      },
      cycleScore: function () {
        cycleScore(el);
      },
      editScoreCell: function () {
        openGrader(el.dataset.sid, el.dataset.aid);
      },
      startScoreMode: function () {
        enterScoreMode(el.dataset.aid);
      },
      showAddAssessPopover: function () {
        showAddAssessPopover(el);
      },
      confirmAddAssess: function () {
        confirmAddAssess();
      },
      cancelAddAssess: function () {
        dismissAddAssessPopover();
      },
      exportScoresCSV: function () {
        exportScoresCSV();
      },
      printGrades: function () {
        if (window.GradesPrint) GradesPrint.open(activeCourse, { term: _printTerm, shownIds: _printShownIds });
      },
      stopPropOnly: function () {
        /* just stop propagation */
      },
    };
    if (handlers[action]) {
      if (action !== 'stopPropOnly' && action !== 'cycleScore' && el.tagName !== 'SELECT') e.preventDefault();
      handlers[action]();
    }
  }

  function _handleInput(e) {
    if (_graderOpen()) return;
    if (e.target.matches('[data-action-input="gbSearch"]')) {
      onSearch(e.target.value, e.target.selectionStart);
    }
  }

  function _handleChange(e) {
    if (_graderOpen()) return;
    if (e.target.matches('[data-action="switchCourse"]')) {
      switchCourse(e.target.value);
    } else if (e.target.matches('[data-action="setRubricColumns"]')) {
      setRubricColumns(e.target.value);
    }
  }

  /* ── init / destroy ─────────────────────────────────────── */
  function init(params) {
    _mounted = true;
    activeCourse = params.course || getActiveCourse();
    setActiveCourse(activeCourse);
    viewMode = 'scores';
    filterSections = [];
    filterModules = [];
    filterCategories = [];
    // From a dashboard link: these students, and one competency's columns.
    filterStudentIds = params.students ? String(params.students).split(',').filter(Boolean) : [];
    var linkedSection = params.section;
    if (
      linkedSection &&
      getSections(activeCourse).some(function (sec) {
        return sec.id === linkedSection;
      })
    )
      filterSections = [linkedSection];
    searchQuery = '';
    searchText = '';
    sortCol = null;
    _filterStripOpen = false;
    _scrollKey = null;
    _tipSource = null;

    // No sidebar for gradebook
    document.getElementById('page-layout').classList.add('sidebar-hidden');
    document.getElementById('sidebar-mount').style.display = 'none';
    var _sidebarToggle = document.querySelector('[data-action="toggleSidebar"]');
    if (_sidebarToggle) _sidebarToggle.style.display = 'none';

    window._pageSwitchCourse = switchCourse;

    _addDocListener('click', _handleClick);
    _addDocListener('contextmenu', function (e) {
      if (_graderOpen()) return;
      // Scores tab context menus
      var cell = e.target.closest('.gb-scores-cell');
      if (cell) {
        e.preventDefault();
        showScoreContextMenu(e, cell);
        return;
      }
      var header = e.target.closest('.gb-grid-colhead, .gb-scores-assess-head');
      // A slanted title acts on the column it leans along, not the box under the pointer.
      if (_inSlantedHeads(e.target)) {
        var hit = _slantedColAt(e.clientX, e.clientY);
        header = hit ? hit.el : null;
        if (!header) e.preventDefault();
      }
      if (header) {
        e.preventDefault();
        showHeaderContextMenu(e, header);
        return;
      }
    });
    _addDocListener('dblclick', function (e) {
      if (_graderOpen()) return;
      var el = e.target.closest('[data-action-dblclick]');
      if (_inSlantedHeads(e.target)) {
        var hit = _slantedColAt(e.clientX, e.clientY);
        el = hit ? hit.el : null;
      }
      if (!el) return;
      e.preventDefault();
      var action = el.dataset.actionDblclick;
      if (action === 'startScoreMode') enterScoreMode(el.dataset.aid);
    });
    _addDocListener('input', _handleInput);
    _addDocListener('change', _handleChange);
    _addDocListener('keydown', _handleKeydown);
    _addDocListener('mouseover', _handleMouseover);
    _addDocListener('mouseout', _handleMouseout);
    _addDocListener('focusin', _handleFocusin);
    _addDocListener('focusout', _handleFocusout);

    render();

    requestAnimationFrame(function () {
      document.getElementById('main').scrollTop = 0;
    });
  }

  function destroy() {
    _mounted = false;
    if (_graderOpen()) PageAssignments.closeGrader();
    ObsCapture.closeDialog();
    if (window.GradesPrint) GradesPrint.close();
    _flushActiveScoreEditor();
    if (_scoreMode) exitScoreMode();
    _listeners.forEach(function (l) {
      document.removeEventListener(l.type, l.handler, l.options);
    });
    _listeners = [];
    if (_scrollShadowCleanup) {
      _scrollShadowCleanup();
      _scrollShadowCleanup = null;
    }
    var gbTip = document.getElementById('gb-tooltip');
    if (gbTip) {
      gbTip.style.display = 'none';
      gbTip.className = '';
    }
    _tipSource = null;
    delete window._pageSwitchCourse;
  }

  /* ── Public API ─────────────────────────────────────────── */
  return {
    init: init,
    destroy: destroy,
    render: render,
    switchCourse: switchCourse,
  };
})();
