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
     criterion ('criteria', the default: no score repeated across columns)
     or one per competency ('competencies'). Remembered per class on this
     device. */
  function rubricColumnsMode(cid) {
    return localStorage.getItem('gb_rubricColumns_' + cid) === 'competencies' ? 'competencies' : 'criteria';
  }
  function setRubricColumns(mode) {
    localStorage.setItem('gb_rubricColumns_' + activeCourse, mode === 'criteria' ? 'criteria' : 'competencies');
    render();
  }
  /* Newest First puts the latest assessments on the left, in both views.
     On unless the teacher turned it off; remembered on this device. */
  var _newestFirst = true;
  try {
    _newestFirst = localStorage.getItem('gb_newestFirst') !== '0';
  } catch (e) {
    /* storage blocked: newest first */
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
  var _averageStudents = null; // the class's students, for Class Average
  var sortCol = null;
  var _filterStripOpen = false;
  var _printShownIds = null;
  // Draft and Returned (S1-F1): the "N to return" filter, and the drafts on
  // screen as the last render counted them (null where grades aren't held).
  var _toReturnOnly = false;
  var _drafts = null;
  var _scrollShadowCleanup = null;
  var _scrollKey = null; // class and view of the last render, so a redraw keeps the table's scroll
  var _tipSource = null;
  // The kind of pointer that last pressed (pointerdown): a tap toggles a
  // header's tip; a mouse click keeps the tip its hover showed. Safari's
  // click carries no pointerType of its own.
  var _lastPointer = 'mouse';
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
    if (window.ClassResults) ClassResults.close();
    activeCourse = cid;
    if (!(await switchActiveCourse(cid))) return;
    _toReturnOnly = false;
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
  /* Student name sort cycles on every click and loops, from the page's
     own order (last name A–Z): last Z–A, first A–Z, first Z–A, last A–Z. */
  var NAME_SORT_CYCLE = [
    { by: 'last', dir: 'asc' },
    { by: 'last', dir: 'desc' },
    { by: 'first', dir: 'asc' },
    { by: 'first', dir: 'desc' },
  ];
  function toggleSort(key) {
    _flushActiveScoreEditor();
    if (key === 'name') {
      // No sort chosen yet is last name A–Z, the cycle's first step; from
      // the Overall sort a click goes back to it.
      var step = sortCol ? -1 : 0;
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

  /* The grid corner's two sort buttons. Student says which name order is
     on (no sort chosen is last name A–Z) and what a click turns it to;
     Overall sorts by the overall grade, lowest first, then highest. */
  var NAME_SORT_TEXT = {
    'last-asc': 'Last Name A\u2013Z',
    'last-desc': 'Last Name Z\u2013A',
    'first-asc': 'First Name A\u2013Z',
    'first-desc': 'First Name Z\u2013A',
  };
  function _cornerSortButtons() {
    var byName = !sortCol || sortCol.key === 'name';
    var cur = byName ? (sortCol ? sortCol.by + '-' + sortCol.dir : 'last-asc') : null;
    var at = cur
      ? NAME_SORT_CYCLE.findIndex(function (c) {
          return c.by + '-' + c.dir === cur;
        })
      : -1;
    var next = NAME_SORT_CYCLE[(at + 1) % NAME_SORT_CYCLE.length];
    var nextText = NAME_SORT_TEXT[next.by + '-' + next.dir];
    var nameTip = cur
      ? 'Sorted by ' + NAME_SORT_TEXT[cur] + '. Click for ' + nextText + '.'
      : 'Click to sort by ' + nextText + '.';
    var byOverall = sortCol && sortCol.key === 'overall';
    var overallTip = byOverall
      ? 'Sorted by Overall, ' +
        (sortCol.dir === 'asc' ? 'lowest' : 'highest') +
        ' first. Click for ' +
        (sortCol.dir === 'asc' ? 'highest' : 'lowest') +
        ' first.'
      : 'Click to sort by Overall, lowest first.';
    return (
      '<button type="button" class="gb-grid-corner-label gb-name-sort" data-action="toggleSort" data-sortkey="name" title="' +
      esc(nameTip) +
      '" aria-label="Student. ' +
      esc(nameTip) +
      '">Student' +
      (cur ? '<span class="gb-sort-order">' + esc(NAME_SORT_TEXT[cur]) + '</span>' : '') +
      '</button>' +
      '<button type="button" class="gb-grid-corner-label gb-name-sort gb-overall-sort" data-action="toggleSort" data-sortkey="overall" title="' +
      esc(overallTip) +
      '" aria-label="Overall. ' +
      esc(overallTip) +
      '">Overall' +
      sortArrow('overall') +
      '</button>'
    );
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
    // The gradebook always shows the year so far (Colin, 2026-11-03): no
    // report's term is in view here.
    if (typeof setActiveTerm === 'function') setActiveTerm(cid, null);
    var everyAssessment = getAssessments(cid);
    var allAssessments = everyAssessment
      .filter(function (a) {
        return !_pendingDeleteAids[a.id];
      })
      .sort(function (a, b) {
        return (a.date || '').localeCompare(b.date || '');
      });
    if (_newestFirst) allAssessments.reverse();
    var sections = getSections(cid);
    var course = COURSES[cid];
    var isLetter = courseShowsLetterGrades(course);
    var scores = getScores(cid);

    // Class Average is the whole class's, whoever a search or a dashboard
    // link leaves on screen.
    _averageStudents = students;

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
    _printShownIds =
      filterCategories.length + filterSections.length + filterModules.length > 0
        ? assessments.map(function (a) {
            return a.id;
          })
        : null;

    // Draft and Returned (S1-F1): the drafts among the students and columns
    // shown, and the "N to return" filter, which leaves only those.
    _drafts = _countDrafts(cid, students, assessments);
    if (!_drafts || !_drafts.total) _toReturnOnly = false;
    if (_toReturnOnly) {
      students = students.filter(function (s) {
        return _drafts.bySid[s.id];
      });
      assessments = assessments.filter(function (a) {
        return _drafts.byAid[a.id];
      });
    }

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
      '" data-action="setView" data-mode="scores" data-label="Scores" role="tab" aria-selected="' +
      (viewMode === 'scores') +
      '">Scores</button>' +
      '<button class="seg-btn gb-seg-btn' +
      (viewMode === 'detailed' ? ' active' : '') +
      '" data-action="setView" data-mode="detailed" data-label="Competencies" role="tab" aria-selected="' +
      (viewMode === 'detailed') +
      '">Competencies</button>' +
      '</div>';

    // The Rubric Columns picker sits in the Competencies corner, beside
    // Newest First, so the toolbar is the same in both views.
    _hasRubricWork = allAssessments.some(function (a) {
      return rubricCriterionColumns(a, cid).length > 0;
    });

    html +=
      '<button class="gb-filter-trigger' +
      (activeFilterCount > 0 ? ' has-filters' : '') +
      '" data-action="toggleFilterStrip" aria-expanded="' +
      _filterStripOpen +
      '" aria-label="Toggle filters' +
      (activeFilterCount > 0 ? ', ' + activeFilterCount + ' active' : '') +
      '">' +
      '<span class="filter-icon" aria-hidden="true">☰</span> Filters' +
      // The count's place is kept when there is none, so turning a filter
      // on doesn't push the search box along.
      (activeFilterCount > 0
        ? ' <span class="filter-count">' + activeFilterCount + '</span>'
        : ' <span class="filter-count is-empty" aria-hidden="true">0</span>') +
      '</button>';

    html +=
      '<div class="gb-search-wrap"><span class="gb-search-icon">' +
      LINE_ICONS.search +
      '</span><input class="gb-search-input" type="text" placeholder="Search…" value="' +
      esc(searchText) +
      '" data-action-input="gbSearch" aria-label="Search students">' +
      (searchText
        ? '<button type="button" class="gb-search-clear" data-action="clearSearch" aria-label="Clear search" title="Clear search">\u00D7</button>'
        : '') +
      '</div>';

    if (filterStudentIds.length) {
      html +=
        '<button class="gb-student-filter" data-action="clearStudentFilter" aria-label="Show all students">Showing ' +
        filterStudentIds.length +
        ' Student' +
        (filterStudentIds.length === 1 ? '' : 's') +
        ' <span aria-hidden="true">\u00D7</span></button>';
    }

    html += _toReturnButton();

    html +=
      '<div style="margin-left:auto;display:flex;align-items:center;gap:12px">' +
      '<button class="tb-toggle-btn" data-action="exportScoresCSV" title="Export CSV" aria-label="Export">\u2913<span class="gb-tb-text"> Export</span></button>' +
      '<button class="tb-action-btn tb-action-secondary" data-action="printGrades" aria-label="Print Grades" title="Print Grades"><span class="gb-tb-icon" aria-hidden="true">' +
      LINE_ICONS.print +
      '</span><span class="gb-tb-text">Print Grades</span></button>' +
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
      '<span class="gb-filter-strip-label">Competencies</span><div class="gb-filter-strip-group">';
    sections.forEach(function (sec) {
      var isActive = filterSections.includes(sec.id);
      html +=
        '<button class="gb-filter-chip' +
        (isActive ? ' active' : '') +
        '" data-action="toggleSectionFilter" data-secid="' +
        sec.id +
        '"><span class="chip-dot" style="background:' +
        cssColor(sec.color) +
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
          cssColor(u.color) +
          '"></span>' +
          esc(u.name) +
          '</button>';
      });
      html += '</div>';
    }

    if (activeFilterCount > 0) {
      html += '<button class="gb-filter-clear" data-action="clearAllFilters">Clear All</button>';
    }
    html += '</div>';

    // ── Table ──
    var empty = _emptyState(cid, everyAssessment, allAssessments, assessments, students);
    if (empty) {
      html += empty;
    } else if (viewMode === 'scores') {
      html += renderScoresTable(cid, students, assessments, sections, isLetter, scores) + _keyHtml();
    } else {
      html += renderDetailedTable(cid, students, assessments, sections, isLetter, scores) + _keyHtml();
    }

    // A redraw (a saved score, a sort, a filter) leaves the table where it
    // was; another class or view starts at the top, and so does the "N to
    // return" filter's shorter grid.
    var scrollKey = cid + '|' + viewMode + (_toReturnOnly ? '|toReturn' : '');
    var prevData = document.getElementById('gb-data');
    var keepScroll =
      prevData && _scrollKey === scrollKey ? { top: prevData.scrollTop, left: prevData.scrollLeft } : null;
    _scrollKey = scrollKey;

    var refocus = _cellKey(document.activeElement);
    var refocusHead =
      document.activeElement && document.activeElement.closest
        ? document.activeElement.closest('#gb-colheads .gb-grid-colhead[data-aid]')
        : null;
    var refocusHeadAid = refocusHead ? refocusHead.dataset.aid : null;
    // html-safe: names, titles and category/section/module names are escaped; colours go through cssColor; grades come from calc.js.
    document.getElementById('main').innerHTML = html;
    applyStickyLeft();
    initScrollShadows();
    initGridScrollSync();
    if (keepScroll) restoreGridScroll(keepScroll);
    initGridHoverSync();
    initHeaderResize();
    initColHoverTooltip();
    var again = refocus && _findCell(refocus);
    if (again) _selectCell(again);
    else _initRovingCell();
    var headAgain =
      refocusHeadAid &&
      document.querySelector(
        '#gb-colheads .gb-grid-colhead[data-aid="' + CSS.escape(refocusHeadAid) + '"] .gb-grid-colhead-label',
      );
    if (headAgain) _focusColhead(headAgain);
    if (window.ClassResults && ClassResults.isOpen()) ClassResults.refresh();
  }

  /* ── Selecting a cell ──────────────────────────────────────
     Each grid is one Tab stop: the selected cell (or the first) has
     tabindex 0, the rest -1. The selection is the .gb-focus cell and has
     the keyboard focus, so it survives a redraw and the grader. */
  function _cellKey(el) {
    if (!el || !el.matches || !el.matches('#gb-data td[data-aid][data-sid]')) return null;
    return {
      scores: el.classList.contains('gb-scores-cell'),
      aid: el.dataset.aid,
      sid: el.dataset.sid,
      tid: el.dataset.tid || '',
    };
  }
  function _findCell(key) {
    var sel =
      '#gb-data td' +
      (key.scores ? '.gb-scores-cell' : '.gb-score') +
      '[data-aid="' +
      CSS.escape(key.aid) +
      '"][data-sid="' +
      CSS.escape(key.sid) +
      '"]' +
      (key.scores ? '' : key.tid ? '[data-tid="' + CSS.escape(key.tid) + '"]' : '[data-pts="1"]');
    return document.querySelector(sel);
  }
  function _selectCell(td, focus) {
    if (_tipSource && _tipSource.matches && _tipSource.matches('td')) _hideTip();
    document.querySelectorAll('#gb-data .gb-focus').forEach(function (el) {
      if (el !== td) el.classList.remove('gb-focus');
    });
    document.querySelectorAll('#gb-data td[tabindex="0"]').forEach(function (el) {
      if (el !== td) el.tabIndex = -1;
    });
    td.classList.add('gb-focus');
    td.tabIndex = 0;
    if (focus !== false) td.focus({ preventScroll: true });
    td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return td;
  }
  function _clearSelection() {
    document.querySelectorAll('#gb-data .gb-focus').forEach(function (el) {
      el.classList.remove('gb-focus');
      if (el === document.activeElement) el.blur();
    });
  }
  function _initRovingCell() {
    var cell = document.querySelector('#gb-data tr[data-sid] td[tabindex]');
    if (cell) cell.tabIndex = 0;
  }
  /* The grid's cells by row: the student rows only, never Class Average. */
  function _gridMatrix() {
    var cellSel = viewMode === 'scores' ? 'td.gb-scores-cell' : 'td.gb-score';
    return Array.prototype.map.call(document.querySelectorAll('#gb-data tbody tr[data-sid]'), function (r) {
      return r.querySelectorAll(cellSel);
    });
  }
  /* A one-line tip under a selected cell (keyboard only). */
  function _showCellTip(td, text) {
    var gbTip = document.getElementById('gb-tooltip');
    if (!gbTip) return;
    gbTip.className = 'dark';
    gbTip.textContent = text;
    gbTip.style.display = 'block';
    _tipSource = td;
    var rect = td.getBoundingClientRect();
    var left = rect.left + rect.width / 2 - gbTip.offsetWidth / 2;
    if (left < 8) left = 8;
    if (left + gbTip.offsetWidth > window.innerWidth - 8) left = window.innerWidth - gbTip.offsetWidth - 8;
    gbTip.style.left = left + 'px';
    gbTip.style.top = rect.bottom + 6 + 'px';
  }

  function _nameCellArrow(e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return false;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || !e.target.closest) return false;
    var rows = _gridMatrix();
    var names = document.querySelectorAll('#gb-rowheads .gb-grid-rowhead-name');
    var name = e.key === 'ArrowRight' && e.target.closest('#gb-rowheads .gb-grid-rowhead-name');
    if (name) {
      var r = Array.prototype.indexOf.call(names, name);
      if (r < 0 || !rows[r] || !rows[r][0]) return false;
      e.preventDefault();
      _selectCell(rows[r][0]);
      return true;
    }
    var cell = e.key === 'ArrowLeft' && e.target.closest('#gb-data td.gb-focus');
    if (!cell) return false;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][0] === cell && names[i]) {
        e.preventDefault();
        _clearSelection();
        names[i].focus();
        return true;
      }
    }
    return false;
  }

  /* Scores view keys: the arrows and Tab move, Return or Space opens the
     grader, Shift+F10 or the Menu key opens the cell menu, Escape lets go. */
  function _scoresKeydown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.target.closest && e.target.closest('a[data-href], button, [role="menu"]')) return;
    if (_scoreMode) return;
    var rows = _gridMatrix();
    if (!rows.length || !rows[0].length) return;
    var focused = document.querySelector('#gb-data td.gb-scores-cell.gb-focus');
    var nav = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Tab'];
    if (!focused) {
      if (['ArrowDown', 'ArrowRight'].indexOf(e.key) >= 0 && !e.target.closest('input, select, textarea')) {
        e.preventDefault();
        _selectCell(rows[0][0]);
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openGrader(focused.dataset.sid, focused.dataset.aid, focused);
      return;
    }
    if (e.key === 'Escape') {
      _clearSelection();
      return;
    }
    if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      e.preventDefault();
      var r = focused.getBoundingClientRect();
      showScoreContextMenu({ clientX: r.left + r.width / 2, clientY: r.bottom }, focused);
      return;
    }
    if (/^[0-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      _scoresTypeDigit(e, focused);
      return;
    }
    if (nav.indexOf(e.key) < 0) return;
    var row = -1,
      col = -1;
    rows.forEach(function (cells, ri) {
      var ci = Array.prototype.indexOf.call(cells, focused);
      if (ci >= 0) {
        row = ri;
        col = ci;
      }
    });
    if (row < 0) return;
    var cols = rows[0].length;
    // Tab past the row's end (or Shift+Tab before its start) leaves the grid.
    if (e.key === 'Tab' && (e.shiftKey ? col === 0 : col === cols - 1)) return;
    e.preventDefault();
    if (e.key === 'ArrowDown') row = Math.min(row + 1, rows.length - 1);
    else if (e.key === 'ArrowUp') row = Math.max(row - 1, 0);
    else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) col = Math.min(col + 1, cols - 1);
    else col = Math.max(col - 1, 0);
    if (rows[row][col]) _selectCell(rows[row][col]);
  }

  /* A digit typed on a selected Scores cell starts Edit Score with it, as
     in a spreadsheet and the Competencies view: any digit on points work,
     1–4 on a level. Work that takes no typed score says what to do. */
  function _scoresTypeDigit(e, cell) {
    var cid = activeCourse;
    var a = getAssessments(cid).find(function (x) {
      return x.id === cell.dataset.aid;
    });
    if (!a) return;
    e.preventDefault();
    var status = getAssignmentStatus(cid, cell.dataset.sid, a.id);
    if (status === 'NS' || status === 'EXC') {
      _showCellTip(
        cell,
        (status === 'NS' ? 'Marked Missing' : 'Excused') + '. Take it off in the cell menu to score this work.',
      );
      return;
    }
    if (isCompletionScored(a)) {
      _showCellTip(cell, 'Complete or Incomplete work is marked in the grader. Press Return to open it.');
      return;
    } else if (isDibelsScored(a)) {
      _showCellTip(cell, 'Press Return to enter the scores.');
      return;
    } else if (isPointsScored(a)) {
      startCellEdit(cell);
    } else if (a.rubricId || a.rubric_id) {
      _showCellTip(cell, 'Scored on the rubric. Press Return to open it.');
      return;
    } else if (/^[1-4]$/.test(e.key)) {
      startCellEdit(cell);
    } else {
      _showCellTip(cell, 'Type a level from 1 to 4.');
      return;
    }
    var inp = cell.querySelector('.gb-scores-input');
    if (inp) inp.value = e.key;
  }

  var _hasRubricWork = false;
  /* The corner's view options: Newest First, and in Competencies the Rubric
     Columns picker when the class has rubric work. */
  function _cornerTools(withRubricCols) {
    var html = '<div class="gb-corner-tools">' + _newestFirstButton();
    if (withRubricCols && _hasRubricWork) {
      var rubricCols = rubricColumnsMode(activeCourse);
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
    return html + '</div>';
  }

  function _newestFirstButton() {
    return (
      '<button class="tb-toggle-btn gb-newest-first' +
      (_newestFirst ? ' active' : '') +
      '" data-action="toggleNewestFirst" aria-pressed="' +
      _newestFirst +
      '" title="Put the latest assessments on the left">Newest First</button>'
    );
  }

  /* One line under the grid: what the colours and marks mean. */
  function _keyHtml() {
    var cid = activeCourse;
    // Graded Separately is in the key only in a class where someone is.
    var separate = getAssessments(cid).some(function (a) {
      return a && Array.isArray(a.gradedSeparately) && a.gradedSeparately.length > 0;
    });
    var html = '<div class="gb-key" aria-label="Key">';
    [1, 2, 3, 4].forEach(function (n) {
      html +=
        '<span class="gb-key-item"><span class="gb-key-swatch" style="background:var(--score-' +
        n +
        ')"></span>' +
        PROF_LABELS[n] +
        '</span>';
    });
    html +=
      '<span class="gb-key-gap"></span>' +
      '<span class="gb-key-item"><span class="gb-status gb-status-ns">M</span>Missing</span>' +
      '<span class="gb-key-item"><span class="gb-status gb-status-exc">EXC</span>Excused</span>' +
      '<span class="gb-key-item"><span class="gb-late">L</span>Late</span>' +
      (separate ? '<span class="gb-key-item"><span class="gb-late gb-separate">S</span>Graded Separately</span>' : '') +
      '<span class="gb-key-item"><span class="gb-key-dash">\u2014</span>No Score</span>' +
      // The dashed mark, in a class that holds grades until they are returned.
      (_drafts
        ? '<span class="gb-key-item gb-key-item-draft"><span class="gb-key-draft"></span>' + DRAFT_KEY_TEXT + '</span>'
        : '') +
      '</div>';
    return html;
  }

  /* \u2500\u2500 Draft and Returned (S1-F1) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
     In a class whose student page is on (the build switch) and that returns
     grades When I Return Them, a grade is a draft until it is returned
     (shared/grade-state.js). The gradebook marks each draft with a dashed
     outline and says so in the key; the toolbar's "N to return" counts the
     drafts on screen and, pressed, leaves only the students and assessments
     that have one; each column's Return N Graded returns its drafts.
     In any other class none of it is drawn: the page's HTML is what it was
     (tests/gradebook-draft-cells.test.js).

     Every count is GradeState.draftsIn, which asks GradeState.stateOf, as
     the grader dialog does: Missing and Excused pieces are never drafts,
     and a DIBELS benchmark is never returned. Nothing here changes a
     number: every grade, average and roll-up in the gradebook is worked
     out from all work, drafts included (the plan, 1.3). */
  var DRAFT_KEY_TEXT = 'Draft: graded, not returned';
  // What a screen reader hears after a draft cell's score.
  var DRAFT_CELL_WORDS = ', Draft, not returned yet';

  /* The drafts among `students` in each of `assessments`:
     { byAid: { aid: [sid] }, bySid: { sid: true }, total }, or null in a
     class that doesn't hold grades. */
  function _countDrafts(cid, students, assessments) {
    var klass = getReturnSettings(cid);
    if (!klass.student_page || !GradeState.holds(klass)) return null;
    var ids = students.map(function (s) {
      return s.id;
    });
    var out = { byAid: {}, bySid: {}, total: 0 };
    assessments.forEach(function (a) {
      var waiting = GradeState.draftsIn(cid, a.id, ids);
      if (!waiting.length) return;
      out.byAid[a.id] = waiting;
      waiting.forEach(function (sid) {
        out.bySid[sid] = true;
      });
      out.total += waiting.length;
    });
    return out;
  }

  // True when `sid`'s piece on `aid` was a draft at the last render.
  function _isDraft(sid, aid) {
    return !!(_drafts && _drafts.byAid[aid] && _drafts.byAid[aid].indexOf(sid) >= 0);
  }

  /* The toolbar's "N to return": the drafts on screen, summed over the
     columns. Pressed, it is the filter; nothing is drawn when N is 0. */
  function _toReturnButton() {
    if (!_drafts || !_drafts.total) return '';
    return (
      '<button type="button" class="gb-to-return' +
      (_toReturnOnly ? ' active' : '') +
      '" data-action="toggleToReturn" aria-pressed="' +
      _toReturnOnly +
      '" title="' +
      (_toReturnOnly
        ? 'Showing only the drafts to return. Click to show everything.'
        : 'Show only the students and assessments with a draft to return.') +
      '">' +
      _drafts.total +
      ' to return' +
      (_toReturnOnly ? ' <span aria-hidden="true">\u00d7</span>' : '') +
      '</button>'
    );
  }

  /* "3 drafts: Avery, Mia and Sam can\u2019t see them yet." for the students in
     `sids`, by first name; past three, "Avery, Mia, Sam and 2 others". */
  function _draftsSentence(cid, sids) {
    var roster = getStudents(cid);
    var names = sids
      .map(function (sid) {
        var st = roster.find(function (s) {
          return s.id === sid;
        });
        return st ? displayNameFirst(st) : '';
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return a.localeCompare(b);
      });
    var n = sids.length;
    var extra = n - 3;
    var who =
      names.length !== n
        ? ''
        : n === 1
          ? names[0]
          : n <= 3
            ? names.slice(0, -1).join(', ') + ' and ' + names[n - 1]
            : names.slice(0, 3).join(', ') + ' and ' + extra + (extra === 1 ? ' other' : ' others');
    var cant = n === 1 ? ' can\u2019t see it yet.' : ' can\u2019t see them yet.';
    return n + (n === 1 ? ' draft' : ' drafts') + ': ' + (who || (n === 1 ? 'the student' : 'the students')) + cant;
  }

  // The student ids of the rows on screen, top to bottom.
  function _rowIds() {
    return Array.prototype.map.call(document.querySelectorAll('#gb-data tr[data-sid]'), function (row) {
      return row.dataset.sid;
    });
  }

  /* Who a column's Return N Graded returns: each of `sids`, and with a
     member of a pair or group the members still graded with them, as the
     grader dialog's Return does (groupGradingUnits). */
  function _returnTogether(cid, aid, sids) {
    var a = getAssessments(cid).find(function (x) {
      return x.id === aid;
    });
    var units = groupGradingUnits(
      cid,
      a,
      sortStudents(getStudents(cid), 'lastName').map(function (s) {
        return s.id;
      }),
    );
    if (!units) return sids;
    var out = sids.slice();
    sids.forEach(function (sid) {
      var unit = units.find(function (u) {
        return u.linked && u.linked.indexOf(sid) >= 0;
      });
      (unit ? unit.linked : []).forEach(function (m) {
        if (out.indexOf(m) < 0) out.push(m);
      });
    });
    return out;
  }

  /* Return N Graded: every draft in the column, among the rows on screen,
     is returned in one action through the one grader. True when any was. */
  function _returnDrafts(aid) {
    var cid = activeCourse;
    var klass = getReturnSettings(cid);
    if (!klass.student_page || !GradeState.holds(klass)) return false;
    var waiting = GradeState.draftsIn(cid, aid, _rowIds());
    if (!waiting.length) return false;
    Grader.returnGrades(cid, aid, _returnTogether(cid, aid, waiting));
    clearProfCache();
    render();
    return true;
  }

  /* Return N Graded under a Competencies header, where the column has no
     menu: drawn only while the assessment has drafts on screen. The Scores
     view has it at the top of the column's menu (showHeaderContextMenu). */
  // html-safe: the id is ours; the names in the title go through esc
  function _returnDraftsButton(cid, a) {
    var waiting = _drafts && _drafts.byAid[a.id];
    if (!waiting) return '';
    return (
      '<button type="button" class="gb-return-drafts" data-action="returnDrafts" data-aid="' +
      a.id +
      '" title="' +
      esc(_draftsSentence(cid, waiting)) +
      '">Return ' +
      waiting.length +
      ' Graded</button>'
    );
  }

  /* What the page says when there is nothing to show, and the one step that
     changes it: no students, no assessments, filters that leave none, or
     a search that finds no one. */
  function _emptyState(cid, everyAssessment, termAssessments, shownAssessments, shownStudents) {
    var hasStudents = getStudents(cid).length > 0;
    var addStudents =
      '<a class="tb-action-btn tb-action-secondary" role="link" tabindex="0" data-href="/dashboard?course=' +
      cid +
      '&manage=students">Add Students</a>';
    var text, action;
    if (!hasStudents && !everyAssessment.length) {
      text = 'This class has no students or assessments yet.';
      action = addStudents;
    } else if (!hasStudents) {
      text = 'No students in this class yet.';
      action = addStudents;
    } else if (!everyAssessment.length) {
      text = 'No assessments in this class yet. Add one with + New Assessment.';
    } else if (!termAssessments.length) {
      text = 'No assessments in this class yet. Add one with + New Assessment.';
    } else if (!shownAssessments.length) {
      text = 'No assessments match these filters.';
      action = '<button class="tb-action-btn tb-action-secondary" data-action="clearAllFilters">Clear Filters</button>';
    } else if (!shownStudents.length && searchQuery) {
      text = 'No students match \u201c' + esc(searchText.trim()) + '\u201d.';
      action = '<button class="tb-action-btn tb-action-secondary" data-action="clearSearch">Clear Search</button>';
    } else if (!shownStudents.length) {
      text = 'None of these students are in this class.';
      action =
        '<button class="tb-action-btn tb-action-secondary" data-action="clearStudentFilter">Show All Students</button>';
    } else return '';
    return '<div class="gb-empty"><p class="gb-empty-text">' + text + '</p>' + (action || '') + '</div>';
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
    // A name that takes the focus (Tab, or ← from a score) scrolls the
    // names' column into view; the scores follow so the rows stay in line.
    rowheads.addEventListener(
      'scroll',
      function () {
        if (Math.abs(rowheads.scrollTop - data.scrollTop) > 1) data.scrollTop = rowheads.scrollTop;
      },
      { passive: true },
    );
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
  /* The slanted header's height: the one the teacher dragged to, kept on
     this device, or else just tall enough for the longest title, up to
     170px (a longer title ends in an ellipsis and shows whole on hover). */
  var _savedHeaderHeight = 0;
  try {
    _savedHeaderHeight = parseInt(localStorage.getItem('gb_headerHeight') || '0', 10) || 0;
  } catch (e) {
    /* storage blocked: fit the titles */
  }
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
        try {
          localStorage.setItem('gb_headerHeight', _headerHeight);
        } catch (e) {
          /* storage blocked: the height holds until the page reloads */
        }
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

  function showColTooltip(colEl, colIdx) {
    // Highlight the column header and its score cells; no card, so
    // nothing covers the scores below.
    if (colEl) colEl.classList.add('gb-col-hover');
    var table = document.querySelector('#gb-data table');
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

  /* What a screen reader hears on a Competencies cell, as the Scores view
     says it: "Mateo Alvarez, Density Worksheet, QAP1: 3, Proficient".
     `value` is the score's text ('' for none); a status replaces it, and
     Late follows it, then that the grade is a draft (`draft`). Escaped for
     an attribute. */
  function _compCellLabel(s, assess, col, status, value, hint, draft) {
    var what = status === 'NS' ? 'Missing' : status === 'EXC' ? 'Excused' : value ? value : 'No score';
    if (status === 'LATE' && value) what += ', Late';
    if (draft) what += DRAFT_CELL_WORDS;
    var code = col.isPointsCol ? '' : col.tagCode ? ', ' + col.tagCode : '';
    return esc(
      fullName(s) + ', ' + ((assess && assess.title) || 'Assessment') + code + ': ' + what + (hint ? '. ' + hint : ''),
    );
  }

  /* The class's overall at the foot of the Overall column, in the Class
     Average row (a CSL reviewer, Nov 5: "Is it possible to get an overall
     class average?"). The mean of every student's Overall, worked out and
     written by calc.js (classGradeSummary), as the dashboard's top bar shows
     it; over the whole class, whoever a search leaves on screen. */
  function _classOverallHtml(cid, cls) {
    var ids = (_averageStudents || getStudents(cid)).map(function (s) {
      return s.id;
    });
    var sum = ids.length ? classGradeSummary(cid, ids) : null;
    if (!sum || !sum.text) return '';
    return (
      '<span class="' +
      cls +
      ' gb-class-overall" style="color:' +
      (PROF_COLORS[sum.level] || PROF_COLORS[0]) +
      '" title="The average of every student’s Overall">' +
      esc(sum.text) +
      '</span>'
    );
  }

  /* A student's name in the grid's left column: a link to their page. */
  /* Whether a student's grade shows a reporting basis (IE, or No Letter
     Grade for goals) for the term in view. That row keeps the name whole and
     shortens the grade with an ellipsis instead, the full text on hover. */
  function _basisRow(cid, sid) {
    return reportingBasis(cid, sid, viewedReportTerm(cid)) !== 'grade';
  }

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
        // Its own competencies, then the whole rubric's, which every
        // criterion feeds.
        var tags = (c.criterion.tagIds || []).slice();
        rubricWholeTagIds(cid, a).forEach(function (t) {
          if (tags.indexOf(t) < 0) tags.push(t);
        });
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
          sectionColor: cssColor(sec ? sec.color : 'var(--text-3)'),
          tagText: codes.length
            ? name + ' \u00b7 ' + codes.join(', ')
            : name + ': counts toward the overall grade only',
        };
      });
  }

  /* The competencies a criterion key stands for: a criterion's competencies
     and the whole rubric's, or the key itself for a competency or a
     criterion with neither. */
  function _keyCompetencyIds(cid, a, key) {
    var rubric =
      a && (a.rubricId || a.rubric_id) && !isPointsScored(a) ? getRubricById(cid, a.rubricId || a.rubric_id) : null;
    var crit =
      rubric &&
      (rubric.criteria || []).find(function (c) {
        return c && c.id === key;
      });
    if (!crit) return [key];
    var ids = (crit.tagIds || []).slice();
    (rubric.tagIds || []).forEach(function (t) {
      if (ids.indexOf(t) < 0) ids.push(t);
    });
    return ids.length ? ids : [key];
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

  // html-safe: titles, names, codes and tips are escaped; colours go through cssColor; ids, levels and grades are ours or calc.js's.
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
        // The header names the competencies the work feeds, as proficiency
        // columns do, or says it feeds none (its total is in the title
        // above), so work that counts toward no proficiency stands out.
        var fedCodes = [];
        tagIds.forEach(function (tid) {
          var code = getSectionForTag(cid, tid) ? _tagShortCode(getTagById(cid, tid)) : '';
          if (code && fedCodes.indexOf(code) < 0) fedCodes.push(code);
        });
        cols.push({
          assessmentId: a.id,
          tagId: '__pts__',
          isPointsCol: true,
          isNameCol: !fedCodes.length,
          tagCode: fedCodes.length ? fedCodes.join(' ') : 'No Competency',
          sectionColor: cssColor(sec ? sec.color : 'var(--text-3)'),
          tagText: fedCodes.length
            ? a.title + ' counts toward ' + fedCodes.join(', ')
            : a.title + ' counts toward no competency',
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
            sectionColor: cssColor(sec ? sec.color : 'var(--text-3)'),
            tagText: key ? key.text || key.label : 'No longer in the learning map',
            groupName: sec ? sec.name || sec.shortName || '' : '',
            // A rubric criterion that feeds no competency keeps its own
            // column, headed by its name: written as named, not as a code.
            isNameCol: !!(key && !key.tag),
          });
        });
      }
      var colCount = cols.length - start;
      // The header is at least 120px; the columns under it share that
      // width, so every header sits exactly over its own columns.
      var unitW = Math.max(criterionCols.length > 0 ? 96 : 54, Math.ceil(120 / colCount));
      var groupW = colCount * unitW;
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
      _cornerTools(true) +
      '<div class="gb-grid-corner-row1">' +
      _cornerSortButtons() +
      '</div>' +
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
      var stripeColor = cssColor(tagSecs.length > 0 ? tagSecs[0].color : 'var(--border)');
      var badges = '';
      if (isCompletionScored(a)) badges += '<span class="gb-assess-badge">\u2713/\u2717</span>';
      else if (a.scoreMode === 'points')
        badges += '<span class="gb-assess-badge">/ ' + (a.maxPoints || 100) + '</span>';
      if (getAssessmentWeight(a) !== 1)
        badges += '<span class="gb-assess-badge">' + esc(formatFactor(getAssessmentWeight(a))) + '</span>';
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
        '<div class="gb-assess-meta">' +
        (assessmentNeedsCategory(cid, a)
          ? '<span class="gb-assess-type-pill gb-needs-category" title="' +
            esc(NEEDS_CATEGORY_TIP) +
            '">' +
            esc(NEEDS_CATEGORY_LABEL) +
            '</span>'
          : showsCategoryBadge(cid, a)
            ? '<span class="gb-assess-type-pill ' +
              categoryClass +
              '" style="background:' +
              catTint.bg +
              ';color:' +
              catTint.fg +
              '" title="' +
              esc(categoryName) +
              '">' +
              esc(categoryName) +
              '</span>'
            : '') +
        '<span class="gb-assess-date">' +
        formatShortDate(a.date) +
        '</span>' +
        badges +
        '</div>' +
        _returnDraftsButton(cid, a) +
        '<div class="gb-assess-stripe" style="background:' +
        stripeColor +
        '"></div>' +
        '</div>';
    });
    html += '</div>';
    // Row 2: tag code headers
    // A group for screen readers, saying how to move along it (_handleHeaderKeys).
    html +=
      '<div class="gb-grid-colheads-row2" role="group" aria-label="Competency columns. Use the left and right arrow keys to move between them.">';
    cols.forEach(function (col, i) {
      var g = colGroupMap[i];
      var altClass = g && g.groupIdx % 2 === 1 ? ' gb-group-alt' : '';
      var tagW = col.colWidth || 54;
      // The competencies behind the column, for the I Can statements its tip lists.
      var tipTags = col.isPointsCol ? [] : col.tagIds || (col.tagId ? [col.tagId] : []);
      html +=
        '<div class="gb-grid-tag-header' +
        altClass +
        (col.isCriterionCol || col.isNameCol ? ' gb-grid-tag-header-crit' : '') +
        // A code longer than five characters drops its spacing so it still fits.
        (!col.isCriterionCol && !col.isNameCol && String(col.tagCode || '').length > 5 ? ' gb-code-long' : '') +
        '" style="flex:0 0 ' +
        tagW +
        'px;width:' +
        tagW +
        'px;border-bottom-color:' +
        col.sectionColor +
        ';color:' +
        col.sectionColor +
        '" data-tip-code="' +
        esc(col.isCriterionCol || col.isNameCol ? '' : col.tagCode) +
        '" data-tip-text="' +
        esc(col.tagText || col.tagCode) +
        '" data-tip-group="' +
        esc(col.groupName || '') +
        '" data-tip-tags="' +
        esc(tipTags.join(',')) +
        // Focusable and tappable (Oct 21 decision: tap a code): Tab or a tap shows the tip.
        // One Tab stop for the whole row of headers (the first); the arrow
        // keys move between them (_handleHeaderKeys).
        '" tabindex="' +
        (i === (_headerStop < cols.length ? _headerStop : 0) ? '0' : '-1') +
        '" aria-label="' +
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
      // The term in view's reporting basis (IE, or No Letter Grade for goals).
      var grade = studentGradeSummary(cid, s.id, viewedReportTerm(cid));
      var color = PROF_COLORS[grade.level] || PROF_COLORS[0];
      var label = levelWord(cid, overall);
      var basisRow = _basisRow(cid, s.id);
      _setNameTip(cid, s, sections);
      html +=
        '<div class="gb-grid-rowhead gb-grid-rowhead-comp' +
        altClass +
        (basisRow ? ' gb-row-basis' : '') +
        '">' +
        _rowheadNameOpen(cid, s) +
        esc(displayName(s)) +
        '</a>' +
        '<span class="gb-grid-rowhead-overall" style="color:' +
        color +
        '"' +
        (basisRow ? ' title="' + esc(grade.text) + '"' : '') +
        '>' +
        (basisRow ? '<span class="gb-grade-text">' + esc(grade.text) + '</span>' : grade.text || '\u2014') +
        (label ? '<small>' + label + '</small>' : '') +
        '</span>' +
        '</div>';
    });
    // Stats row header, with the class's own Overall at the foot of that column
    html +=
      '<div class="gb-grid-rowhead gb-grid-rowhead-comp gb-grid-rowhead-stats">Class Average' +
      _classOverallHtml(cid, 'gb-grid-rowhead-overall') +
      '</div>';
    html += '</div>';

    // Q4: Data cells — score grid
    html +=
      '<div class="gb-grid-data" id="gb-data"><table class="gb-table" role="grid" aria-label="Scores by competency"><tbody>';
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
        var cellStatus = getAssignmentStatus(cid, s.id, col.assessmentId);
        var statusMark = scoreStatusMarker(cellStatus, cid, assess);
        var lateMark = cellStatus === 'LATE' ? lateMarkHtml() : '';
        // A draft is the whole piece: each of its cells is dashed (S1-F1).
        var draft = _isDraft(s.id, col.assessmentId);
        var draftClass = draft ? ' gb-draft' : '';
        if (col.isPointsCol && isCompletionScored(assess)) {
          var mark = getCompletionMark(cid, s.id, col.assessmentId);
          html +=
            '<td class="gb-score gb-score-pts' +
            startClass +
            altClass +
            draftClass +
            '"' +
            cellStyle +
            ' tabindex="-1" role="gridcell" aria-label="' +
            _compCellLabel(
              s,
              assess,
              col,
              cellStatus,
              mark ? (mark === 'complete' ? 'Complete' : 'Incomplete') : '',
              '',
              draft,
            ) +
            '" data-aid="' +
            col.assessmentId +
            '" data-pts="1" data-cmp="1" data-sid="' +
            s.id +
            '" data-action="editScoreCell" data-kb="1" title="' +
            (mark ? (mark === 'complete' ? 'Complete' : 'Incomplete') : '') +
            '">' +
            (statusMark || completionCellHtml(mark) + (mark ? lateMark : '')) +
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
                '</span>' +
                lateMark +
                '</span><span class="gb-pts-pct">' +
                pct +
                '%</span></div>'
              : '<span class="gb-pts-empty">\u2014</span>';
          html +=
            '<td class="gb-score gb-score-pts' +
            startClass +
            altClass +
            draftClass +
            '"' +
            cellStyle +
            ' tabindex="-1" role="gridcell" aria-label="' +
            _compCellLabel(
              s,
              assess,
              col,
              cellStatus,
              score != null ? formatPoints(score) + ' out of ' + max : '',
              '',
              draft,
            ) +
            '" data-aid="' +
            col.assessmentId +
            '" data-pts="1" data-sid="' +
            s.id +
            '" data-max="' +
            max +
            '" data-action="editScoreCell" data-kb="1" title="' +
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
              ? formatScoreLevel(score, entry.mod) + lateMark
              : assigned
                ? '<span class="gb-unscored">\u2014</span>'
                : '\u2014';
          var rubricTitle =
            entry && entry.whole
              ? 'Scored by the whole rubric: its criteria come to ' +
                formatPointsPercent(entry.average, 4) +
                '. Click to grade it on the rubric.'
              : mixed
                ? 'The criteria on this competency disagree, so the lowest is shown. Click to grade it on the rubric.'
                : 'Click to grade it on the rubric.';
          html +=
            '<td class="gb-score' +
            startClass +
            altClass +
            draftClass +
            '"' +
            cellStyle +
            ' tabindex="-1" role="gridcell" aria-label="' +
            _compCellLabel(
              s,
              assess,
              col,
              cellStatus,
              score > 0 ? formatScoreLevel(score, entry.mod) + ', ' + scoreLevelText(score, entry.mod) : '',
              rubricCol ? 'Scored on the rubric. Press Return to open it.' : '',
              draft,
            ) +
            '" data-aid="' +
            col.assessmentId +
            '" data-tid="' +
            col.tagId +
            (col.tagIds && col.tagIds.length > 1 ? '" data-tids="' + esc(col.tagIds.join(',')) : '') +
            '" data-sid="' +
            s.id +
            '"' +
            (rubricCol
              ? ' data-action="editScoreCell" title="' + rubricTitle + '"'
              : ' data-action="editScoreCell" data-kb="1"') +
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
        html += _pointsAverageCell(cid, _averageStudents || sortedStudents, col, startClass + altClass, wStyle);
        return;
      }
      // calc.js's one column rule; a criterion column (Rubrics by Criterion)
      // averages every competency the criterion feeds.
      var colAssess = assessments.find(function (a) {
        return a.id === col.assessmentId;
      });
      var stats = classColumnAverage(cid, _averageStudents || sortedStudents, {
        assessment: colAssess,
        tagIds: col.tagIds || [col.tagId],
      });
      if (!stats)
        html +=
          '<td class="gb-score gb-avg-cell' +
          startClass +
          altClass +
          '" style="' +
          wStyle +
          '"' +
          _avgCellAttrs(cid, colAssess) +
          '><span class="gb-score-val s0" style="background:transparent">\u2014</span></td>';
      else {
        html +=
          '<td class="gb-score gb-avg-cell' +
          startClass +
          altClass +
          '" style="' +
          wStyle +
          '"' +
          _avgCellAttrs(cid, colAssess) +
          '><span class="gb-avg-val" style="color:' +
          PROF_COLORS[Math.round(stats.avg)] +
          ';font-weight:700">' +
          formatColumnAverageLevel(cid, stats.avg) +
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
  // html-safe: titles, names and designations are escaped; colours go through cssColor; cell text comes from calc.js.
  function renderScoresTable(cid, students, assessments, sections, isLetter, scores) {
    var sortedStudents = applySorting(cid, students, sections, isLetter);
    var cw = getCategoryWeights(cid);
    var rowH = '';

    // In the order the Newest First switch gives (render).
    var sortedAssess = assessments.slice();

    var html = '';
    var rowPx = 40;

    // 4-quadrant grid: corner | col-headers / row-headers | data
    html += '<div class="gb-grid">';

    // Q1: Corner (top-left, fixed)
    html +=
      '<div class="gb-grid-corner gb-grid-corner-comp">' +
      _cornerTools(false) +
      '<div class="gb-grid-corner-row1">' +
      _cornerSortButtons() +
      '</div></div>';

    // Q2: Column headers (top-right, scrolls horizontally)
    html += '<div class="gb-grid-colheads" id="gb-colheads"><div class="gb-grid-colheads-inner">';
    // The titles are one Tab stop: ← → move along them, and Return, Space
    // or Shift+F10 opens the column's menu (_colheadKeys).
    var headStop = sortedAssess.some(function (a) {
      return a.id === _colheadStopAid;
    })
      ? _colheadStopAid
      : sortedAssess[0] && sortedAssess[0].id;
    sortedAssess.forEach(function (a) {
      var categoryId = _getAssessmentCategoryId(a);
      var categoryName = _getCategoryName(cid, categoryId);
      var typeClass = _getAssessmentAccentClass(a, 'gb-scores');
      var isScoreOnly = isPointsScored(a);
      var shortDate = formatShortDate(a.date);
      // Points work says what it's out of; Complete/Incomplete has no total.
      var maxPts =
        isScoreOnly && !isCompletionScored(a) ? (shortDate ? ' \u00b7 ' : '') + 'Out of ' + (a.maxPoints || 100) : '';
      var tagSecs = (a.tagIds || [])
        .map(function (tid) {
          return getSectionForTag(cid, tid);
        })
        .filter(Boolean);
      var stripeColor = cssColor(tagSecs.length > 0 ? tagSecs[0].color : 'var(--border)');
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
        '<div class="gb-grid-colhead-label" role="button" aria-haspopup="menu" tabindex="' +
        (a.id === headStop ? '0' : '-1') +
        '" aria-label="' +
        esc(a.title) +
        ', column menu" title="' +
        esc(a.title) +
        '">' +
        '<span class="gb-colhead-name-row"><span class="gb-scores-assess-name">' +
        esc(a.title) +
        '</span><span class="gb-colhead-menu-mark" aria-hidden="true">\u25BE</span></span>' +
        '<span class="gb-scores-assess-meta">' +
        shortDate +
        maxPts +
        (_collabMetaText(a) ? (shortDate || maxPts ? ' \u00b7 ' : '') + _collabMetaText(a) : '') +
        (assessmentNeedsCategory(cid, a)
          ? (shortDate || maxPts ? ' \u00b7 ' : '') +
            '<span class="gb-needs-category" title="' +
            esc(NEEDS_CATEGORY_TIP) +
            '">' +
            esc(NEEDS_CATEGORY_LABEL) +
            '</span>'
          : '') +
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
      // proficiency, the letter and %, or both stacked, each in its colour,
      // with the term in view's reporting basis (IE, or No Letter Grade).
      var badges = studentGradeBadges(cid, s.id, viewedReportTerm(cid));
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
      var basisRow = _basisRow(cid, s.id);
      _setNameTip(cid, s, sections);
      html +=
        '<div class="gb-grid-rowhead' +
        altClass +
        (basisRow ? ' gb-row-basis' : '') +
        '">' +
        _rowheadNameOpen(cid, s) +
        esc(displayName(s)) +
        desTags +
        '</a>' +
        '<span class="gb-grid-rowhead-grade">' +
        (gradeParts.length
          ? gradeParts
              .map(function (p) {
                return (
                  '<span class="gb-grade-text" style="color:' +
                  (PROF_COLORS[p.level] || PROF_COLORS[0]) +
                  '"' +
                  (basisRow ? ' title="' + esc(p.text) + '"' : '') +
                  '>' +
                  esc(p.text) +
                  '</span>'
                );
              })
              .join('') +
            // A Proficiency class's overall says its word under the number,
            // as the Competencies view does, so colour isn't the only sign.
            (gradeParts.length === 1 && badges.prof && levelWord(cid, getOverallProficiency(cid, s.id))
              ? '<small class="gb-grade-word" style="color:' +
                (PROF_COLORS[badges.prof.level] || PROF_COLORS[0]) +
                '">' +
                levelWord(cid, getOverallProficiency(cid, s.id)) +
                '</small>'
              : '')
          : '<span style="color:var(--text-3)">\u2014</span>') +
        '</span>' +
        '</div>';
    });
    html +=
      '<div class="gb-grid-rowhead gb-grid-rowhead-stats gb-scores-stats-head">Class Average' +
      _classOverallHtml(cid, 'gb-grid-rowhead-grade') +
      '</div>';
    html += '</div>';

    // Q4: Data cells (bottom-right, scrolls both ways — drives the others)
    html +=
      '<div class="gb-grid-data" id="gb-data"><table class="gb-scores-table ' +
      rowH +
      '" role="grid" aria-label="Scores"><tbody>';
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
          display =
            cell.text + (cell.late ? lateMarkHtml() : '') + (isGradedSeparately(a, s.id) ? separateMarkHtml() : '');
        } else if (cell.kind === 'points' || cell.kind === 'level') {
          var r = cell.level;
          cellStyle = 'background:' + PROF_TINT[r] + ';color:' + PROF_COLORS[r];
          display =
            (cell.kind === 'level' ? _levelCellHtml(cid, cell.value, cell) : esc(cell.text)) +
            (cell.late ? lateMarkHtml() : '') +
            (isGradedSeparately(a, s.id) ? separateMarkHtml() : '');
          // Warning for out-of-range: above 4 on proficiency work, above the
          // extra-credit cap (twice the maximum) on points work.
          if (cell.outOfRange) cellClass = ' gb-scores-warning';
        } else if (cell.kind === 'dibels' && cell.dibels) {
          // A DIBELS benchmark's latest reading level, as a word; not a grade.
          var dl = { above: 4, core: 3, strategic: 2, intensive: 1 }[cell.dibels.level] || 0;
          cellStyle = dl ? 'background:' + PROF_TINT[dl] + ';color:' + PROF_COLORS[dl] : 'color:var(--text-3)';
          display = '<span class="gb-scores-dibels">' + esc(cell.text) + '</span>';
        } else {
          cellStyle = 'color:var(--text-3)';
          display = '\u2014';
        }
        // A draft: the dashed outline in the level's colour, and no fill
        // (S1-F1). A Missing or Excused piece is never one.
        var draft = _isDraft(s.id, a.id);
        if (draft) {
          cellClass += ' gb-draft';
          if (cell.kind === 'points' || cell.kind === 'level') cellStyle = 'color:' + PROF_COLORS[cell.level];
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
          '" tabindex="-1" role="gridcell" aria-label="' +
          esc(displayName(s)) +
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
                ? cell.kind === 'points'
                  ? cell.text + ' out of ' + (a.maxPoints || 100)
                  : cell.text + (levelWord(cid, cell.level) ? ', ' + levelWord(cid, cell.level) : '')
                : 'no score') +
          (cell.late && !statusMark ? ', Late' : '') +
          (draft ? DRAFT_CELL_WORDS : '') +
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
    // Class Average under each column: calc.js's one column rule, written
    // as the printed sheet and the CSV write it.
    html += '<tr class="gb-stats-row gb-scores-stats">';
    sortedAssess.forEach(function (a) {
      var stats = classColumnAverage(cid, _averageStudents || sortedStudents, { assessment: a });
      if (!stats) {
        html +=
          '<td class="gb-scores-avg"' +
          _avgCellAttrs(cid, a) +
          '><span class="gb-avg-val" style="color:var(--text-3)">\u2014</span></td>';
        return;
      }
      var level = isPointsScored(a)
        ? pointsToProf(stats.pct != null ? stats.pct : 0, 100, getGradingScale(cid))
        : Math.round(stats.avg);
      html +=
        '<td class="gb-scores-avg"' +
        _avgCellAttrs(cid, a) +
        '><span class="gb-avg-val" style="color:' +
        (PROF_COLORS[level] || PROF_COLORS[0]) +
        '">' +
        (isCompletionScored(a)
          ? _csvAverageText(cid, a, stats)
          : isPointsScored(a)
            ? _pointsAverageText(a, stats)
            : _levelCellHtml(cid, stats.avg)) +
        '</span></td>';
    });
    html += '</tr>';
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
    var grade = courseGradeMode(cid) === 'letter' ? studentGradeSummary(cid, sid, viewedReportTerm(cid)) : null;
    var r = grade ? grade.level : Math.round(val);
    var color = PROF_COLORS[r] || PROF_COLORS[0];
    var label = levelWord(cid, val);
    var num = grade ? grade.text || '—' : levelFigure(val);
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
    var grade = studentGradeSummary(cid, student.id, viewedReportTerm(cid));
    var word = levelWord(cid, getOverallProficiency(cid, student.id));
    // The full name first: the name column cuts long ones off.
    var tip =
      '<div class="gb-tip-name">' +
      esc(displayName(student)) +
      '</div>' +
      '<div class="gb-tip-head">Course Grade</div>' +
      '<div class="gb-tip-grade" style="color:' +
      (grade.text ? PROF_COLORS[grade.level] || PROF_COLORS[0] : 'var(--text-3)') +
      '">' +
      (grade.text ? (word ? word + ' (' + esc(grade.text) + ')' : esc(grade.text)) : 'No Evidence') +
      '</div>';
    // NS lowers only a percentage; a Proficiency class shows none. Only work
    // the grade above counts: the year so far, outside 0% categories.
    if (courseGradeMode(cid) !== 'proficiency') {
      var ns = _scopedAssessments(cid).filter(function (a) {
        return getAssignmentStatus(cid, student.id, a.id) === 'NS' && countsTowardGrades(cid, a);
      }).length;
      if (ns > 0)
        tip +=
          '<div class="gb-tip-note">' +
          ns +
          (ns === 1 ? ' assessment missing (counts as 0)' : ' assessments missing (count as 0)') +
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
        esc(r ? levelText(cid, sp) : PROF_LABELS[0]) +
        (r && n ? ' <span class="gb-tip-count">· ' + n + (n === 1 ? ' assessment' : ' assessments') + '</span>' : '') +
        '</span></div>';
    });
    var handedIn = Object.keys(allIds).length;
    tip += '<div class="gb-tip-head">Competencies</div>';
    if (handedIn > 0)
      tip +=
        '<div class="gb-tip-note">From ' +
        handedIn +
        (handedIn === 1 ? ' assessment' : ' assessments') +
        ' handed in</div>';
    tip += '<div class="gb-tip-rows">' + rows + '</div>';
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

  /* A Class Average cell opens Class Results (a click, Enter or Space;
     class-results.js listens for data-action="classResults") and shows the
     Class Average card on hover or focus. */
  function _avgCellAttrs(cid, a) {
    if (!a) return '';
    return (
      ' data-action="classResults" data-cid="' +
      esc(cid) +
      '" data-aid="' +
      esc(a.id) +
      '" tabindex="0" role="button" aria-label="' +
      esc('Class Results for ' + (a.title || 'this assessment')) +
      '"'
    );
  }

  /* ── Complete / Incomplete cells ───────────────────────── */
  // Class Average for a points or Complete/Incomplete column: the average
  // points (or % complete), as the course % counts them.
  function _pointsAverageCell(cid, students, col, classes, wStyle) {
    var assess = getAssessments(cid).find(function (a) {
      return a.id === col.assessmentId;
    });
    var stats = assess ? getClassPointsAverage(cid, students, assess) : null;
    var open =
      '<td class="gb-score gb-avg-cell' + classes + '" style="' + wStyle + '"' + _avgCellAttrs(cid, assess) + '>';
    if (!stats) return open + '<span class="gb-score-val s0" style="background:transparent">\u2014</span></td>';
    var r = pointsToProf(stats.pct, 100, getGradingScale(cid));
    var text = isCompletionScored(assess) ? Math.round(stats.pct) + '%' : _pointsAverageText(assess, stats);
    return (
      open + '<span class="gb-avg-val" style="color:' + PROF_COLORS[r] + ';font-weight:700">' + text + '</span></td>'
    );
  }

  /* A level in a Scores cell. A Both class shows the proficiency over its
     percent, so "3.0 · 75%" fits the 48px column its title leans over.
     cell: a student's cell (assessmentCellValue), whose % is the piece's
     own; none for a Class Average. */
  function _levelCellHtml(cid, value, cell) {
    if (courseGradeMode(cid) !== 'both') return esc(cell ? cell.text : formatColumnAverageLevel(cid, value));
    return (
      '<span class="gb-cell-both"><span>' +
      esc(formatLevelAs(cid, value, 'proficiency')) +
      '</span><small>' +
      esc(cell ? cell.percentText : formatLevelAs(cid, value, 'percent')) +
      '</small></span>'
    );
  }

  /* Late keeps the score and adds an L after it, as the printed sheet does. */
  function lateMarkHtml() {
    return '<span class="gb-late" title="Late">L</span>';
  }

  /* A Pair or Group member graded on their own (Grade Separately) gets an S
     after their score, in the same small-letter style as Late. */
  function separateMarkHtml() {
    return '<span class="gb-late gb-separate" title="Graded Separately">S</span>';
  }

  /* " · Group" or " · Pair" after the date of work graded by group. */
  function _collabMetaText(a) {
    var lists = a.collaboration === 'pair' ? a.pairs : a.collaboration === 'group' ? a.groups : null;
    if (!lists || !lists.length) return '';
    return a.collaboration === 'pair' ? 'Pair' : 'Group';
  }

  function completionCellHtml(mark) {
    if (mark === 'complete') return '<span class="gb-cmp gb-cmp-complete">\u2713</span>';
    if (mark === 'incomplete') return '<span class="gb-cmp gb-cmp-incomplete">\u2717</span>';
    return '<span class="gb-pts-empty">\u2014</span>';
  }

  // Click order: unmarked → Complete → Incomplete → unmarked.
  function nextCompletionMark(mark) {
    return mark === 'complete' ? 'incomplete' : mark === 'incomplete' ? null : 'complete';
  }

  function setCellCompletion(td, mark) {
    var cid = activeCourse;
    var sid = td.dataset.sid;
    var aid = td.dataset.aid;
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var undo = _pushUndo(cid, sid, aid, assess ? scoreTagIds(assess, cid) : []);
    Grader.setMark(cid, sid, aid, mark);
    _undoSaved(undo);
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
    if (cell) _selectCell(cell);
    return cell;
  }

  /* Remember the entries `keys` hold now, for Cmd+Z. Call _undoSaved with
     what this returns once the edit is saved. */
  function _pushUndo(cid, sid, aid, keys) {
    var entries = getScores(cid)[sid] || [];
    var undo = {
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
    };
    _undoStack.push(undo);
    while (_undoStack.length > 50) _undoStack.shift();
    return undo;
  }

  /* What a cell's `keys` hold now: its scores, + / − and comments. An
     entry with no score and no text is the same as none, so a cleared cell
     still matches after a refresh drops or keeps its empty row. */
  function _undoCellState(cid, sid, aid, keys) {
    var entries = getScores(cid)[sid] || [];
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    return JSON.stringify(
      keys.map(function (key) {
        var e = entries.find(function (x) {
          return x.assessmentId === aid && x.tagId === key;
        });
        if (!e) return null;
        if (!isScoreEntered(assess, e) && !e.note && !e.reportNote && !e.critNote && !e.critBeyond) return null;
        return [
          e.score == null || e.score === '' ? null : Number(e.score),
          e.mod || 0,
          e.note || '',
          e.reportNote || '',
          e.critNote || '',
          e.critBeyond || '',
        ];
      }),
    );
  }

  /* After the edit an undo entry was pushed for: what it left, so Cmd+Z can
     tell when something else (the grader, the Assignments page, another
     device) has changed the cell since. */
  function _undoSaved(undo) {
    undo.after = _undoCellState(undo.cid, undo.sid, undo.aid, undo.tagIds);
  }

  /* The edit Cmd+Z undoes: the newest one made in the class on screen.
     Null when there is none, or when the cell has changed since; the newer
     work stays and that edit can no longer be undone. */
  function _takeUndo() {
    for (var i = _undoStack.length - 1; i >= 0; i--) {
      if (_undoStack[i].cid !== activeCourse) continue;
      var undo = _undoStack.splice(i, 1)[0];
      if (undo.statuses) return _bulkStatusStillSet(undo) ? undo : null;
      return _undoCellState(undo.cid, undo.sid, undo.aid, undo.tagIds) === undo.after ? undo : null;
    }
    return null;
  }

  /* Puts back what one score edit replaced (an entry _takeUndo or
     _takeUndoEntry handed over), ticks included, and redraws. */
  function _restoreUndo(undo) {
    if (_scoreToast === undo) {
      _scoreToast = null;
      if (typeof dismissUndoToast === 'function') dismissUndoToast();
    }
    var scores = getScores(undo.cid);
    if (!scores[undo.sid]) scores[undo.sid] = [];
    var beforeScores = structuredClone(scores);
    // Missing or Excused work takes no score (isScoreLocked): an undo
    // puts back no level or points under the status.
    var undoAssess = getAssessments(undo.cid).find(function (a) {
      return a.id === undo.aid;
    });
    var undoLocked = isScoreLocked(undo.cid, undo.sid, undo.aid);
    // Restore previous entries (full objects)
    (undo.tagIds || []).forEach(function (tid, i) {
      var prevEntry = undo.prevEntries[i];
      if (prevEntry && undoLocked && isScoreEntered(undoAssess, prevEntry)) prevEntry = null;
      // Remove current entry for this tag
      var idx = scores[undo.sid].findIndex(function (e) {
        return e.assessmentId === undo.aid && e.tagId === tid;
      });
      if (idx >= 0) scores[undo.sid].splice(idx, 1);
      // Restore previous entry if it existed
      if (prevEntry) scores[undo.sid].push(prevEntry);
    });
    Grader.undoCell(undo.cid, undo.sid, undo.aid, beforeScores, scores);
    // The Advanced Rubric ticks Clear Score took off.
    (undo.checkIds || []).forEach(function (id) {
      Grader.setTick(undo.cid, undo.sid, undo.aid, id, true);
    });
    clearProfCache();
    if (_mounted && activeCourse === undo.cid) render();
  }

  /* `undo` taken off the stack for its toast's Undo, when the cell still
     holds what the edit left. Null when it is gone or the cell has changed. */
  function _takeUndoEntry(undo) {
    var i = _undoStack.indexOf(undo);
    if (i < 0) return null;
    _undoStack.splice(i, 1);
    return _undoCellState(undo.cid, undo.sid, undo.aid, undo.tagIds) === undo.after ? undo : null;
  }

  /* Whether what an edit replaced held a score, so clearing it is worth a toast. */
  function _undoHadScore(undo) {
    var assess = getAssessments(undo.cid).find(function (a) {
      return a.id === undo.aid;
    });
    return undo.prevEntries.some(function (e) {
      return e && isScoreEntered(assess, e);
    });
  }

  /* After a score is cleared: an Undo toast, as elsewhere in the app. Its
     Undo and Cmd+Z put back the same thing. */
  var _scoreToast = null; // the clear the Undo toast on screen is for
  function _showClearToast(undo) {
    if (typeof showUndoToast !== 'function') return;
    var student = getStudents(undo.cid).find(function (s) {
      return s.id === undo.sid;
    });
    _scoreToast = undo;
    showUndoToast(
      'Score cleared' + (student ? ' for ' + displayNameWithLast(student) : ''),
      function () {
        _scoreToast = null;
        var taken = _takeUndoEntry(undo);
        if (taken) _restoreUndo(taken);
      },
      function () {
        if (_scoreToast === undo) _scoreToast = null;
      },
      10000,
    );
  }

  /* The points assessment a Competencies-view cell is on, or null. */
  function _cellPointsAssess(td) {
    var a = td.dataset.aid
      ? getAssessments(activeCourse).find(function (x) {
          return x.id === td.dataset.aid;
        })
      : null;
    return a && a.scoreMode === 'points' ? a : null;
  }

  /* The score keys a Competencies-view cell writes: its one key, or every
     key of its rubric criterion (data-tids) in Criteria mode. */
  function _cellScoreKeys(td) {
    var tids = (td.dataset.tids || '').split(',').filter(Boolean);
    return tids.length ? tids : [td.dataset.tid];
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
    var undo = _pushUndo(cid, sid, aid, tids);
    var level = entry.score;
    tids.forEach(function (key) {
      Grader.typePlusMinus(
        cid,
        sid,
        aid,
        key,
        level,
        assess ? assess.date : courseToday(cid),
        scoreTypeFor(assess),
        entry.note || '',
        next,
      );
    });
    _undoSaved(undo);
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
      // A number box reads a typo ("8..5", "7-", any letter in Safari) as
      // blank. It isn't one: the saved score stays.
      if (inp.validity && inp.validity.badInput) {
        _redrawCompetencyCell(td);
        return;
      }
      var raw = parsePointsInput(inp.value, max);
      var undo = _pushUndo(cid, sid, aid, isPtsCol ? scoreTagIds(assess, cid) : [td.dataset.tid]);
      if (isPtsCol) {
        Grader.setPoints(cid, sid, aid, raw);
      } else {
        var tidVal = td.dataset.tid;
        Grader.typeLevel(cid, sid, aid, tidVal, raw || 0, assess.date || courseToday(cid), scoreTypeFor(assess));
      }
      _undoSaved(undo);
      _redrawCompetencyCell(td);
    }
    inp.addEventListener('blur', commit);
    // Return saves and moves to the next student, as levels and C / I do;
    // Tab saves and moves right.
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        commit();
        var cell = document.querySelector('#gb-data td.gb-focus');
        if (!cell) return;
        if (e.key === 'Enter') kbAdvanceDown(document.querySelector('.gb-table'), cell);
        else {
          var row = cell.parentElement.querySelectorAll('td.gb-score');
          var next = row[Array.prototype.indexOf.call(row, cell) + 1];
          if (next) _selectCell(next);
        }
      } else if (e.key === 'Escape') {
        done = true;
        wrap.remove();
        if (existing) existing.style.display = '';
        td.focus({ preventScroll: true });
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
    var today = courseToday(cid);

    var pop = document.createElement('div');
    pop.className = 'gb-add-popover';
    // html-safe: category and section names are escaped, colours go through cssColor; ids and today's date are ours.
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
      '<div class="gb-add-field"><label>Competencies <span style="font-weight:400;color:var(--text-3)">(optional)</span></label>' +
      '<div class="gb-add-tags">' +
      sections
        .map(function (sec) {
          return (
            '<label class="gb-add-tag"><input type="checkbox" value="' +
            (sec.tags[0] ? sec.tags[0].id : sec.id) +
            '" checked>' +
            '<span style="color:' +
            cssColor(sec.color) +
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
    var date = (document.getElementById('gb-new-date') || {}).value || courseToday(activeCourse);
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
    if (cell.kind === 'dibels') return cell.dibels ? cell.text : '';
    return '';
  }

  /* A points Class Average on screen, in both views: "6/10". */
  function _pointsAverageText(a, stats) {
    return formatPoints(Math.round(stats.avg * 10) / 10) + '/' + formatPoints(Number(a.maxPoints) || 100);
  }

  /* A Class Average as the CSV prints it, the printed sheet's way. */
  function _csvAverageText(cid, a, stats) {
    if (!stats) return '';
    if (isCompletionScored(a)) return Math.round(stats.pct) + '%';
    if (isPointsScored(a)) return formatPoints(Math.round(stats.avg * 10) / 10);
    return formatColumnAverageLevel(cid, stats.avg, 'proficiency');
  }

  function exportScoresCSV() {
    var cid = activeCourse;
    var students = sortStudents(getStudents(cid), 'lastName');
    // The export matches the page: the year so far.
    var assessments = getAssessments(cid)
      .slice()
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
      // The % as the class shows it (whole or one decimal), as the Grade column has it.
      var finalPct = _getDisplayedFinalPercent(cid, s.id);
      row.push(finalPct != null ? formatCoursePercent(cid, finalPct) : '');
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
      avgRow.push(_csvAverageText(cid, a, classColumnAverage(cid, students, { assessment: a })));
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
    a.download = (COURSES[cid] ? COURSES[cid].name : 'gradebook') + '_scores.csv';
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

  /* A cell or column menu: arrow keys move through its items, Return or
     Space picks one, Escape closes it and gives focus back. The click that
     closes it does nothing else, so it can't open the grader under it. */
  var _menuReturnFocus = null;
  var _headClickTimer = null;
  function _wireMenu(menu, invoker) {
    menu.setAttribute('role', 'menu');
    menu.tabIndex = -1;
    menu.querySelectorAll('.gb-ctx-item').forEach(function (item) {
      item.setAttribute('role', 'menuitem');
      item.tabIndex = -1;
    });
    menu.querySelectorAll('.gb-ctx-divider').forEach(function (d) {
      d.setAttribute('role', 'separator');
    });
    _menuReturnFocus = invoker && invoker.hasAttribute('tabindex') ? invoker : document.activeElement;
    menu.addEventListener('keydown', _menuKeydown);
    document.addEventListener('click', _menuClickAway, true);
    menu.focus({ preventScroll: true });
  }

  function _menuClickAway(e) {
    var menu = document.querySelector('.gb-ctx-menu');
    if (menu && menu.contains(e.target)) return;
    if (menu) {
      e.preventDefault();
      e.stopPropagation();
    }
    _dismissContextMenu();
  }

  function _menuKeydown(e) {
    var menu = e.currentTarget;
    var items = Array.prototype.filter.call(menu.querySelectorAll('.gb-ctx-item'), function (it) {
      return !it.classList.contains('is-disabled');
    });
    var at = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      if (!items.length) return;
      var next =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? items.length - 1
            : e.key === 'ArrowDown'
              ? (at + 1) % items.length
              : at <= 0
                ? items.length - 1
                : at - 1;
      items[next].focus();
    } else if ((e.key === 'Enter' || e.key === ' ') && at >= 0) {
      items[at].click();
    } else if (e.key === 'Escape') {
      _dismissContextMenu(true);
    } else if (e.key === 'Tab') {
      _dismissContextMenu(true);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }

  function _dismissContextMenu(restoreFocus) {
    document.removeEventListener('click', _menuClickAway, true);
    var existing = document.querySelector('.gb-ctx-menu');
    if (existing) existing.remove();
    document.querySelectorAll('.gb-col-menu').forEach(function (el) {
      el.classList.remove('gb-col-menu');
    });
    var back = _menuReturnFocus;
    _menuReturnFocus = null;
    if (restoreFocus === true && back && back.isConnected && back.focus) back.focus({ preventScroll: true });
  }

  var STATUS_LOCKED_TITLE =
    'This student has a score or feedback on this work. Clear it first to mark Missing or Excused.';
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
        (locked ? ' is-disabled" aria-disabled="true" title="' + STATUS_LOCKED_TITLE : '') +
        '" data-ctx="' +
        ctx +
        '">' +
        label +
        '</div>'
      );
    }
    // Clear Score has nothing to clear on a cell with no score (Nov 3 sweep).
    var cellAssess = getAssessments(activeCourse).find(function (a) {
      return a.id === aid;
    });
    var hasScore =
      (getScores(activeCourse)[sid] || []).some(function (en) {
        return en && en.assessmentId === aid && isScoreEntered(cellAssess, en);
      }) || getRubricCheckIds(activeCourse, sid, aid).length > 0;
    var menu = document.createElement('div');
    menu.className = 'gb-ctx-menu';
    // html-safe: statusItem gets only fixed actions and labels.
    menu.innerHTML =
      '<div class="gb-ctx-item" data-ctx="editCell">Edit Score</div>' +
      '<div class="gb-ctx-item' +
      (hasScore ? '' : ' is-disabled" aria-disabled="true" title="There is no score to clear.') +
      '" data-ctx="clearCell">Clear Score</div>' +
      '<div class="gb-ctx-divider"></div>' +
      statusItem('markMissing', 'NS', status === 'NS' ? 'Undo Missing' : 'Mark Missing') +
      statusItem('excuseCell', 'EXC', status === 'EXC' ? 'Undo Excuse' : 'Excuse') +
      statusItem('lateCell', 'LATE', status === 'LATE' ? 'Undo Late' : 'Mark Late') +
      '<div class="gb-ctx-divider"></div>' +
      '<div class="gb-ctx-item" data-ctx="addObservation">Add Observation</div>';
    _placeContextMenu(menu, e.clientX, e.clientY);
    _wireMenu(menu, cell);
    menu.addEventListener('click', function (ev) {
      var item = ev.target.closest('[data-ctx]');
      if (!item || item.classList.contains('is-disabled')) return;
      var action = item.dataset.ctx;
      // The cell takes the focus back first, so it keeps it through the
      // redraw the item makes (Gradebook sweep 4).
      _dismissContextMenu(true);
      if (action === 'editCell') startCellEdit(cell);
      else if (action === 'addObservation') openObservationDialog(sid, aid);
      else if (action === 'clearCell') {
        var cid = activeCourse;
        var scores = getScores(cid);
        var assess = getAssessments(cid).find(function (a) {
          return a.id === aid;
        });
        if (assess && scores[sid]) {
          // ⌘Z puts it back, as it does for Edit Score, ticks included.
          var clearIds = scoreTagIds(assess, cid);
          var checkIds = getRubricCheckIds(cid, sid, aid);
          var undo = _pushUndo(cid, sid, aid, clearIds);
          undo.checkIds = checkIds;
          // An Advanced Rubric's ticks go with the score, so reopening it
          // doesn't suggest a level for work that has none.
          checkIds.forEach(function (id) {
            Grader.setTick(cid, sid, aid, id, false);
          });
          var hadScore = _undoHadScore(undo) || checkIds.length > 0;
          Grader.clearScore(cid, scores, sid, assess, clearIds);
          _undoSaved(undo);
          clearProfCache();
          render();
          Grader.clearScoreOnServer(cid, sid, aid);
          if (hadScore) _showClearToast(undo);
        }
      } else if (action === 'markMissing' || action === 'excuseCell' || action === 'lateCell') {
        // Same path as the Assignments page's NS / EXC / Late buttons; picking
        // the cell's current status again takes it off.
        var next = action === 'markMissing' ? 'NS' : action === 'excuseCell' ? 'EXC' : 'LATE';
        Grader.setStatus(activeCourse, sid, aid, status === next ? null : next);
        clearProfCache();
        render();
      }
      _dismissContextMenu();
    });
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
      title: 'Add Observation',
      subtitle: displayName(student) + ' \u00b7 ' + (assess.title || 'Assessment'),
      students: [sid],
      lockStudents: true,
      assessmentId: aid,
      lockAssessment: true,
      draftKey: 'gb-cell|' + sid + '|' + aid,
    });
  }

  /* The cells Mark Blank Cells Missing / Excused set in one column, kept on
     this device so Undo Marking Blank Cells can take them off again. */
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

  /* One use of Mark Blank Cells Missing / Excused, for its Undo toast and
     Cmd+Z: true while every cell it marked still holds that status. */
  function _bulkStatusStillSet(undo) {
    var st = getAssignmentStatuses(undo.cid);
    return undo.statuses.every(function (u) {
      return st[u.sid + ':' + undo.aid] === u.status;
    });
  }

  /* Takes off the statuses one use set, where a cell still holds it, and
     drops them from Undo Marking Blank Cells' list. */
  function _undoBulkStatus(undo) {
    var i = _undoStack.indexOf(undo);
    if (i >= 0) _undoStack.splice(i, 1);
    var st = getAssignmentStatuses(undo.cid);
    undo.statuses.forEach(function (u) {
      var key = u.sid + ':' + undo.aid;
      if (st[key] === u.status) delete st[key];
    });
    Grader.undoMarkBlankCells(undo.cid, undo.aid, st);
    _saveBulkStatusUndo(
      undo.cid,
      undo.aid,
      _bulkStatusUndo(undo.cid, undo.aid).filter(function (u) {
        return !undo.statuses.some(function (x) {
          return x.sid === u.sid && x.status === u.status;
        });
      }),
    );
    if (_bulkToast === undo) {
      _bulkToast = null;
      if (typeof dismissUndoToast === 'function') dismissUndoToast();
    }
    clearProfCache();
    if (_mounted && activeCourse === undo.cid) render();
  }
  var _bulkToast = null; // the use the Undo toast on screen is for

  /* Mark Blank Cells Missing / Excused, from the column's menu (the rows on
     screen) and from Class Results' Unmarked list: each of `sids` with
     nothing in the column (no score, no mark, no status) becomes NS
     (counted as 0) or EXC, with an Undo toast and Cmd+Z. */
  function _markBlankCells(aid, next, sids) {
    var assess = getAssessments(activeCourse).find(function (a) {
      return a.id === aid;
    });
    if (!assess) return;
    var statuses = getAssignmentStatuses(activeCourse);
    var undo = _bulkStatusUndo(activeCourse, aid);
    var marked = [];
    (sids || []).forEach(function (sid) {
      var cell = assessmentCellValue(activeCourse, sid, assess);
      if (cell.kind === 'none' && !cell.status && canSetAssignmentStatus(activeCourse, sid, aid, next)) {
        statuses[sid + ':' + aid] = next;
        undo.push({ sid: sid, status: next });
        marked.push({ sid: sid, status: next });
      }
    });
    if (!marked.length) return;
    Grader.markBlankCells(activeCourse, aid, statuses);
    _saveBulkStatusUndo(activeCourse, aid, undo);
    clearProfCache();
    render();
    // Undo from the toast or Cmd+Z takes off just these.
    var use = { cid: activeCourse, aid: aid, statuses: marked };
    _undoStack.push(use);
    while (_undoStack.length > 50) _undoStack.shift();
    _bulkToast = use;
    showUndoToast(
      marked.length +
        (marked.length === 1 ? ' blank cell' : ' blank cells') +
        ' marked ' +
        (next === 'NS' ? 'Missing' : 'Excused'),
      function () {
        _undoBulkStatus(use);
      },
      function () {
        if (_bulkToast === use) _bulkToast = null;
      },
      10000,
    );
  }

  function showHeaderContextMenu(e, header) {
    _dismissContextMenu();
    var aid = header.dataset.aid;
    var menu = document.createElement('div');
    menu.className = 'gb-ctx-menu';
    var assess = getAssessments(activeCourse).find(function (a) {
      return a.id === aid;
    });
    // View Class Results shows the column's Class Average beside it.
    var avgHint = '';
    if (assess && !isDibelsScored(assess)) {
      var colAvg = classColumnAverage(activeCourse, _averageStudents || getStudents(activeCourse), {
        assessment: assess,
      });
      if (colAvg) avgHint = 'Avg ' + classColumnAverageText(activeCourse, assess, colAvg);
    }
    // Return N Graded and who is waiting, when the column has drafts (S1-F1).
    var waiting = _drafts ? GradeState.draftsIn(activeCourse, aid, _rowIds()) : [];
    // html-safe: the hint is a figure from calc.js, escaped; the drafts line's names go through esc
    menu.innerHTML =
      (waiting.length
        ? '<div class="gb-ctx-note">' +
          esc(_draftsSentence(activeCourse, waiting)) +
          '</div>' +
          '<div class="gb-ctx-item gb-ctx-return" data-ctx="returnDrafts">Return ' +
          waiting.length +
          ' Graded</div>' +
          '<div class="gb-ctx-divider"></div>'
        : '') +
      '<div class="gb-ctx-item" data-ctx="scoreMode">Grade This Assessment</div>' +
      '<div class="gb-ctx-item gb-ctx-split" data-ctx="viewResults"><span>View Class Results</span>' +
      (avgHint ? '<span class="gb-ctx-hint">' + esc(avgHint) + '</span>' : '') +
      '</div>' +
      '<div class="gb-ctx-item" data-ctx="editAssess">Edit Assessment Details</div>' +
      '<div class="gb-ctx-divider"></div>' +
      '<div class="gb-ctx-item" data-ctx="markUngradedNS">Mark Blank Cells Missing</div>' +
      '<div class="gb-ctx-item" data-ctx="markUngradedEXC">Mark Blank Cells Excused</div>' +
      (_bulkStatusUndo(activeCourse, aid).length
        ? '<div class="gb-ctx-item" data-ctx="undoBulkStatus">Undo Marking Blank Cells</div>'
        : '') +
      '<div class="gb-ctx-divider"></div>' +
      '<div class="gb-ctx-item gb-ctx-danger" data-ctx="deleteAssess">Delete Assessment</div>';
    // The column stays highlighted while its menu is open, so it is clear
    // which assignment the menu acts on.
    header.classList.add('gb-col-menu');
    document.querySelectorAll('.gb-scores-cell[data-aid="' + aid + '"]').forEach(function (cell) {
      cell.classList.add('gb-col-menu');
    });
    _placeContextMenu(menu, e.clientX, e.clientY);
    _wireMenu(menu, header.querySelector('.gb-grid-colhead-label') || header);
    menu.addEventListener('click', function (ev) {
      var item = ev.target.closest('[data-ctx]');
      if (!item) return;
      var action = item.dataset.ctx;
      _dismissContextMenu(true);
      if (action === 'returnDrafts') _returnDrafts(aid);
      else if (action === 'scoreMode') {
        // The grader opens on the top student in the order shown.
        var firstRow = document.querySelector('.gb-scores-row[data-sid]');
        if (firstRow) openGrader(firstRow.dataset.sid, aid);
      } else if (action === 'viewResults') {
        if (window.ClassResults)
          ClassResults.open(activeCourse, aid, { from: header.querySelector('.gb-grid-colhead-label') || header });
      } else if (action === 'editAssess') Router.navigate('/assignments?course=' + activeCourse + '&edit=' + aid);
      else if (action === 'markUngradedNS' || action === 'markUngradedEXC') {
        // Every student row on screen with nothing in this column.
        _markBlankCells(
          aid,
          action === 'markUngradedNS' ? 'NS' : 'EXC',
          Array.prototype.map.call(document.querySelectorAll('.gb-scores-row[data-sid]'), function (row) {
            return row.dataset.sid;
          }),
        );
      } else if (action === 'undoBulkStatus') {
        // Takes off only the NS / EXC the bulk items set, and only where the
        // cell still holds that status.
        var st = getAssignmentStatuses(activeCourse);
        _bulkStatusUndo(activeCourse, aid).forEach(function (u) {
          var key = u.sid + ':' + aid;
          if (st[key] === u.status) delete st[key];
        });
        Grader.undoMarkBlankCells(activeCourse, aid, st);
        _saveBulkStatusUndo(activeCourse, aid, []);
        clearProfCache();
        render();
      } else if (action === 'deleteAssess') {
        // P7.8: replace native confirm with the in-app dialog so the dialog
        // can spell out irreversibility and stay consistent with other
        // destructive actions in the gradebook.
        // The dialog names the assignment so a click on the wrong column is
        // caught before anything happens.
        var title = assess && assess.title ? assess.title : 'this assessment';
        // A linked copy in another class stays; say so, as Assignments does.
        var copyNote = window.AssessmentCopy && assess ? AssessmentCopy.deleteNote(activeCourse, assess) : '';
        showConfirm(
          'Delete “' + title + '”?',
          'All scores, statuses, and observations linked to this assessment will be removed.' +
            copyNote +
            ' You can undo this for a few seconds.',
          'Delete',
          'danger',
          function () {
            _deleteAssessWithUndo(activeCourse, aid, title);
          },
        );
      }
      _dismissContextMenu();
    });
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
    Grader.deleteAssessmentScores(cid, aid, scores);
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
    if (statusChanged) Grader.deleteAssessmentStatuses(cid, aid, statuses);
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
  /* The grader steps through the students shown, in their order. The cell
     stays selected when it closes, so the keyboard carries on from it. */
  function openGrader(sid, aid, cell) {
    if (!window.PageAssignments || !sid || !aid) return;
    var ids = Array.prototype.map.call(document.querySelectorAll('#gb-data tr[data-sid]'), function (row) {
      return row.dataset.sid;
    });
    var key = _cellKey(cell);
    _hideTip();
    PageAssignments.openGrader(activeCourse, aid, sid, {
      studentIds: ids,
      // Closing selects the cell of the student the grader ended on.
      onClose: function (lastSid) {
        clearProfCache();
        render();
        var at = key ? Object.assign({}, key) : { scores: viewMode === 'scores', aid: aid, sid: sid, tid: '' };
        if (lastSid) at.sid = lastSid;
        var back =
          _findCell(at) ||
          document.querySelector(
            '#gb-data tr[data-sid="' +
              CSS.escape(at.sid) +
              '"] td[data-aid="' +
              CSS.escape(aid) +
              '"][data-sid="' +
              CSS.escape(at.sid) +
              '"]',
          );
        if (back) _selectCell(back);
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
    // Rubric work is scored criterion by criterion, and Complete/Incomplete
    // has two marks, so neither takes a typed number: they open the grader.
    if (isCompletionScored(assess) || (!isPointsScored(assess) && (assess.rubricId || assess.rubric_id))) {
      openGrader(sid, aid, td);
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
    inp.step = isPts ? 'any' : '1';
    inp.min = isPts ? '0' : '1';
    inp.max = isPts ? String(maxPts * POINTS_EXTRA_CREDIT_FACTOR) : '4';
    if (isPts) inp.inputMode = 'decimal';
    inp.className = 'gb-scores-input';
    var currentPts = isPts ? getPointsScore(cid, sid, aid) : null;
    if (isPts) inp.value = currentPts != null ? formatPoints(currentPts) : '';
    else inp.value = currentVal > 0 ? String(Math.round(currentVal)) : '';
    td.appendChild(inp);
    inp.focus();
    inp.select();
    // What the cell opened with. A Scores cell shows one value for the whole
    // assessment (the average of its competencies), so writing it back
    // unchanged would flatten each competency's own score and +/−.
    var openedValue = inp.value;

    function save() {
      // A number box reads a typo ("8..5", "7-", any letter in Safari) as
      // blank. It isn't one: the saved score stays.
      if (inp.validity && inp.validity.badInput) return;
      var typed = String(inp.value).trim();
      var val = isPts ? parsePointsInput(typed, maxPts) : Number(typed);
      // Only a blank box clears: null for points (where 0 is a score), 0 for
      // levels. Anything else that isn't a score (a typo, 3.5 or 9 as a
      // proficiency) leaves the saved score alone.
      if (typed === '') val = isPts ? null : 0;
      else if (isPts ? val == null || isNaN(val) : !(val >= 1 && val <= 4 && val === Math.round(val))) return;
      var undo = _pushUndo(cid, sid, aid, tagIds);
      // Apply score to all tags in this assessment. A save this device
      // couldn't keep shows on the sync dot (data.js), not here.
      if (isPts) {
        // One value for the whole assessment, mirrored onto each competency.
        Grader.setPoints(cid, sid, aid, val);
      } else {
        tagIds.forEach(function (tid) {
          Grader.typeLevel(cid, sid, aid, tid, val, assess.date || courseToday(cid), scoreTypeFor(assess), '');
        });
      }
      _undoSaved(undo);
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
      var commitKey = _refocusAfterCommit ? _cellKey(td) : null;
      render();
      var commitBack = commitKey && _findCell(commitKey);
      if (commitBack) _selectCell(commitBack);
    }

    var _refocusAfterCommit = false;
    var _navDir = null; // 'down' | 'right' | null
    var _cancelled = false; // Escape: removing the input blurs it, and blur saves
    inp.addEventListener('blur', function (ev) {
      if (_cancelled) return;
      // Focus going nowhere (Return or Tab at a row's end, a click on the
      // page) comes back to the cell; a click on another control keeps it.
      _refocusAfterCommit = !ev || !ev.relatedTarget;
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
        var escKey = _cellKey(td);
        inp.remove();
        if (span) span.style.display = '';
        exitScoreMode();
        // The cell keeps the keyboard, as after the grader.
        var escBack = escKey && _findCell(escKey);
        if (escBack) _selectCell(escBack);
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
    var newCell = rows[newRow] ? rows[newRow].querySelectorAll('td.gb-score')[curCol] : null;
    if (newCell) _selectCell(newCell);
  }

  function _handleKeydown(e) {
    if (_graderOpen()) return;
    // Escape closes a tooltip first (WCAG 1.4.13: dismissible without moving).
    if (e.key === 'Escape' && _tipSource) _hideTip();
    // Escape in the search box clears it; the box keeps the focus.
    if (e.key === 'Escape' && e.target.matches && e.target.matches('.gb-search-input') && searchText) {
      e.preventDefault();
      onSearch('', 0);
      return;
    }
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
      var undo = _takeUndo();
      if (!undo) return;
      if (undo.statuses) {
        _undoBulkStatus(undo);
        return;
      }
      _restoreUndo(undo);
      return;
    }
    if (_colheadKeys(e)) return;
    // Keys on a competency header move along the headers (_handleHeaderKeys), not the grid.
    if (e.target.closest && e.target.closest('.gb-grid-tag-header')) return;
    // → on a student's name goes to their first score; ← on a first score
    // goes back to the name.
    if (_nameCellArrow(e)) return;
    if (viewMode === 'scores') {
      _scoresKeydown(e);
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
      if (first) _selectCell(first);
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
      _clearSelection();
      return;
    } else if (
      !focused.dataset.kb &&
      (['+', '=', '-', '_', 'Backspace', 'Delete'].includes(e.key) || /^[0-9]$/.test(e.key))
    ) {
      // A competency of rubric work is scored on the rubric: Enter or a
      // click opens the grader (editScoreCell), and typed scores do nothing;
      // the cell says so.
      e.preventDefault();
      _showCellTip(focused, 'Scored on the rubric. Press Return to open it.');
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
    } else if (
      ['1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(e.key) ||
      // On points work 0 is a score, typed like any other digit; on a level
      // it clears (below).
      (e.key === '0' && _cellPointsAssess(focused))
    ) {
      var ptsAssess = _cellPointsAssess(focused);
      if (ptsAssess) {
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
        var undo = _pushUndo(activeCourse, sid, aid, keys);
        keys.forEach(function (key) {
          Grader.typeLevel(
            activeCourse,
            sid,
            aid,
            key,
            val,
            assess ? assess.date : courseToday(activeCourse),
            scoreTypeFor(assess),
            '',
          );
        });
        _undoSaved(undo);
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
        var cmpUndo = _undoStack[_undoStack.length - 1];
        if (cmpUndo && cmpUndo.aid === aid && cmpUndo.sid === sid && _undoHadScore(cmpUndo)) _showClearToast(cmpUndo);
        return;
      }
      if (aid && sid) {
        var assess = getAssessments(activeCourse).find(function (a) {
          return a.id === aid;
        });
        var undo = null;
        if (focused.dataset.pts === '1') {
          undo = _pushUndo(activeCourse, sid, aid, assess ? scoreTagIds(assess, activeCourse) : []);
          Grader.setPoints(activeCourse, sid, aid, null);
          _undoSaved(undo);
        } else if (tid) {
          var clearKeys = _cellScoreKeys(focused);
          undo = _pushUndo(activeCourse, sid, aid, clearKeys);
          clearKeys.forEach(function (key) {
            Grader.typeLevel(
              activeCourse,
              sid,
              aid,
              key,
              0,
              assess ? assess.date : courseToday(activeCourse),
              scoreTypeFor(assess),
              '',
            );
          });
          _undoSaved(undo);
        }
        _redrawCompetencyCell(focused);
        if (undo && _undoHadScore(undo)) _showClearToast(undo);
      }
      return;
    } else return;
    var newCell = rows[newRow] ? rows[newRow].querySelectorAll('td.gb-score')[newCol] : null;
    if (newCell) _selectCell(newCell);
  }

  /* ── Tooltip ─────────────────────────────────────────────── */
  var _nameTipTimer = null;
  function _handleMouseover(e) {
    if (_graderOpen()) return;
    var name = e.target.closest('.gb-grid-rowhead-name');
    if (name) {
      // A short pause first, so moving across the names doesn't flash cards.
      if (name !== _tipSource) {
        clearTimeout(_nameTipTimer);
        _nameTipTimer = setTimeout(function () {
          if (name.isConnected && name.matches(':hover')) _showNameTip(name);
        }, 400);
      }
      return;
    }
    var avgCell = e.target.closest('#gb-data .gb-stats-row td[data-action="classResults"]');
    if (avgCell) {
      if (avgCell !== _tipSource) _showAvgTip(avgCell);
      return;
    }
    var assessGroup = e.target.closest('.gb-grid-assess-group');
    if (assessGroup) {
      _showAssessTitleTip(assessGroup);
      return;
    }
    var codeHead = e.target.closest('.gb-grid-tag-header');
    if (codeHead && codeHead !== _tipSource) _showCodeTip(codeHead);
  }

  /* The Class Average card: above the cell (the row is at the foot of the
     grid), below it when there is no room. Not while Class Results is open
     on that column; DIBELS work has no card. */
  function _showAvgTip(td) {
    var gbTip = document.getElementById('gb-tooltip');
    if (!gbTip || !window.ClassResults) return;
    var aid = td.dataset.aid;
    if (ClassResults.isOpen() && td.classList.contains('cr-is-open')) return;
    var a = getAssessments(activeCourse).find(function (x) {
      return x.id === aid;
    });
    var tipHtml = a ? ClassResults.cardHtml(activeCourse, _averageStudents || getStudents(activeCourse), a) : '';
    if (!tipHtml) return;
    gbTip.className = 'gb-tip-avg';
    // html-safe: ClassResults.cardHtml escapes every string; figures come from calc.js.
    gbTip.innerHTML = tipHtml;
    gbTip.style.display = 'block';
    _tipSource = td;
    var rect = td.getBoundingClientRect();
    var h = gbTip.offsetHeight;
    var w = gbTip.offsetWidth;
    var top = rect.top - h - 6;
    if (top < 8) top = rect.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    var left = rect.left + rect.width / 2 - w / 2;
    if (left < 8) left = 8;
    if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8);
    gbTip.style.left = left + 'px';
    gbTip.style.top = top + 'px';
  }

  /* A competency code's header: at once, the code, its wording and its group
     (a criterion column: its whole name). */
  function _showCodeTip(head) {
    var gbTip = document.getElementById('gb-tooltip');
    if (!gbTip || !head.dataset.tipText) return;
    var code = head.dataset.tipCode;
    var group = head.dataset.tipGroup;
    gbTip.className = 'dark';
    // The I Can statements of each competency behind the column, named when
    // there are several (a rubric criterion on two competencies).
    var cid = activeCourse;
    var tags = String(head.dataset.tipTags || '')
      .split(',')
      .filter(Boolean)
      .map(function (id) {
        return getTagById(cid, id);
      })
      .filter(function (t) {
        return t && (t.i_can_statements || []).some(Boolean);
      });
    var icans = tags
      .map(function (t) {
        return (
          (tags.length > 1 ? '<div class="gb-code-tip-sub">' + esc(_tagShortCode(t) || t.label || '') + '</div>' : '') +
          '<ul class="gb-code-tip-icans">' +
          t.i_can_statements
            .filter(Boolean)
            .map(function (x) {
              return '<li>' + esc(x) + '</li>';
            })
            .join('') +
          '</ul>'
        );
      })
      .join('');
    // html-safe: code, wording, group and every I Can statement through esc
    gbTip.innerHTML =
      '<div class="gb-code-tip">' +
      (code ? '<strong>' + esc(code) + '</strong> ' : '') +
      esc(head.dataset.tipText) +
      (group ? '<div class="gb-code-tip-group">' + esc(group) + '</div>' : '') +
      icans +
      '</div>';
    gbTip.style.display = 'block';
    _tipSource = head;
    var rect = head.getBoundingClientRect();
    var left = rect.left + rect.width / 2 - gbTip.offsetWidth / 2;
    if (left < 8) left = 8;
    if (left + gbTip.offsetWidth > window.innerWidth - 8) left = window.innerWidth - gbTip.offsetWidth - 8;
    gbTip.style.left = left + 'px';
    // A long I Can list stays inside the window.
    var top = rect.bottom + 6;
    if (top + gbTip.offsetHeight > window.innerHeight - 8)
      top = Math.max(8, window.innerHeight - gbTip.offsetHeight - 8);
    gbTip.style.top = top + 'px';
  }

  /* Under the student's row (over it near the bottom of the window), so the
     row and its scores stay in view. */
  function _showNameTip(name) {
    var gbTip = document.getElementById('gb-tooltip');
    var tipHtml = name.dataset.sid ? _nameTipHtml[name.dataset.sid] : null;
    if (!gbTip || !tipHtml) return;
    gbTip.className = '';
    // html-safe: tipHtml is built by _setNameTip, which escapes category and section names and grade text.
    gbTip.innerHTML = tipHtml;
    gbTip.style.display = 'block';
    // A long competency list goes into two columns so the card fits the
    // window; past that it is cut at the window's height.
    gbTip.classList.toggle('gb-tip-wide', gbTip.offsetHeight > window.innerHeight - 16);
    _tipSource = name;
    var row = name.closest('.gb-grid-rowhead') || name;
    var rect = row.getBoundingClientRect();
    var left = rect.left + 8;
    var top = rect.bottom + 4;
    if (top + gbTip.offsetHeight > window.innerHeight - 8) top = rect.top - gbTip.offsetHeight - 4;
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

  /* ← and → move between the competency headers, carrying the one Tab stop
     with the focus, so Tab reaches the score grid after a single header. */
  // The header that holds the Tab stop, kept across redraws.
  /* Keys on a Scores column title: ← → Home End move along the titles,
     Return, Space, Shift+F10 or the Menu key open the column's menu. True
     when the key was used. */
  var _colheadStopAid = null;
  function _colheadKeys(e) {
    var label = e.target.closest && e.target.closest('#gb-colheads .gb-grid-colhead-label');
    if (!label) return false;
    var head = label.closest('.gb-grid-colhead');
    if (e.key === 'Enter' || e.key === ' ' || (e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      e.preventDefault();
      var r = label.getBoundingClientRect();
      showHeaderContextMenu({ clientX: r.left + r.width / 2, clientY: r.bottom }, head);
      return true;
    }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) < 0) return false;
    var labels = Array.prototype.slice.call(document.querySelectorAll('#gb-colheads .gb-grid-colhead-label'));
    var at = labels.indexOf(label);
    var to = e.key === 'Home' ? 0 : e.key === 'End' ? labels.length - 1 : e.key === 'ArrowRight' ? at + 1 : at - 1;
    e.preventDefault();
    var next = labels[to];
    if (!next || next === label) return true;
    _focusColhead(next);
    return true;
  }
  function _focusColhead(label) {
    document.querySelectorAll('#gb-colheads .gb-grid-colhead-label[tabindex="0"]').forEach(function (el) {
      if (el !== label) el.tabIndex = -1;
    });
    label.tabIndex = 0;
    var head = label.closest('.gb-grid-colhead');
    _colheadStopAid = head ? head.dataset.aid : null;
    label.focus({ preventScroll: true });
    // The header row follows the grid's scroll, so the grid scrolls to it.
    var data = document.getElementById('gb-data');
    var colheads = document.getElementById('gb-colheads');
    if (data && colheads && head) {
      var box = colheads.getBoundingClientRect();
      var r = head.getBoundingClientRect();
      if (r.right > box.right) data.scrollLeft += r.right - box.right + 8;
      else if (r.left < box.left) data.scrollLeft -= box.left - r.left + 8;
    }
  }

  var _headerStop = 0;
  function _handleHeaderKeys(e) {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) < 0) return;
    var head = e.target.closest && e.target.closest('.gb-grid-tag-header');
    if (!head) return;
    var heads = Array.prototype.slice.call(head.parentElement.querySelectorAll('.gb-grid-tag-header'));
    var at = heads.indexOf(head);
    var to = e.key === 'Home' ? 0 : e.key === 'End' ? heads.length - 1 : e.key === 'ArrowRight' ? at + 1 : at - 1;
    var next = heads[to];
    e.preventDefault();
    if (!next || next === head) return;
    head.setAttribute('tabindex', '-1');
    next.setAttribute('tabindex', '0');
    _headerStop = to;
    // The header row follows the score grid's scroll (a transform), so the
    // grid scrolls to bring the header into view rather than the row itself.
    next.focus({ preventScroll: true });
    var data = document.getElementById('gb-data');
    var colheads = document.getElementById('gb-colheads');
    if (data && colheads) {
      var box = colheads.getBoundingClientRect();
      var r = next.getBoundingClientRect();
      if (r.right > box.right) data.scrollLeft += r.right - box.right + 8;
      else if (r.left < box.left) data.scrollLeft -= box.left - r.left + 8;
    }
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
    // Tabbing into a grid selects the cell that takes the focus.
    var cell = e.target.closest('#gb-data td[data-aid][data-sid]');
    if (cell) {
      if (!cell.classList.contains('gb-focus')) _selectCell(cell, false);
      return;
    }
    var name = e.target.closest('.gb-grid-rowhead-name');
    if (name) {
      _showNameTip(name);
      return;
    }
    var avgCell = e.target.closest('#gb-data .gb-stats-row td[data-action="classResults"]');
    if (avgCell) {
      _showAvgTip(avgCell);
      return;
    }
    var link = e.target.closest('.gb-grid-assess-group .gb-assess-title');
    if (link) _showAssessTitleTip(link.closest('.gb-grid-assess-group'));
    var codeHead = e.target.closest('.gb-grid-tag-header');
    if (codeHead) _showCodeTip(codeHead);
  }

  function _handleFocusout(e) {
    if (_tipSource && _tipSource.contains(e.target)) _hideTip();
  }

  function _handleMouseout(e) {
    if (e.target.closest && e.target.closest('.gb-grid-rowhead-name')) clearTimeout(_nameTipTimer);
    if (_tipSource) {
      var related = e.relatedTarget;
      if (!related || !_tipSource.contains(related)) _hideTip();
    }
  }

  /* ── Delegated click handler ──────────────────────────────── */
  function _handleClick(e) {
    if (_graderOpen()) return;
    // A click selects the cell it lands on (and opens the grader below);
    // a click anywhere else lets the selection go.
    var td = e.target.closest('#gb-data td.gb-score, #gb-data td.gb-scores-cell');
    if (td && td.closest('.gb-stats-row')) td = null;
    if (td) _selectCell(td);
    else if (!e.target.closest('#grader-overlay, .gb-ctx-menu')) {
      document.querySelectorAll('#gb-data .gb-focus').forEach(function (el) {
        el.classList.remove('gb-focus');
      });
    }

    // A click on a slanted column title opens its menu, after the
    // double-click time so a double-click (Score Mode) doesn't also open it.
    if (_inSlantedHeads(e.target)) {
      var hit = _slantedColAt(e.clientX, e.clientY);
      // A click on a title is that title's column.
      var onLabel = e.target.closest('.gb-grid-colhead-label');
      if (onLabel) hit = { el: onLabel.closest('.gb-grid-colhead') };
      clearTimeout(_headClickTimer);
      if (hit && e.detail <= 1) {
        var at = { clientX: e.clientX, clientY: e.clientY };
        _headClickTimer = setTimeout(function () {
          if (hit.el.isConnected && !_graderOpen()) showHeaderContextMenu(at, hit.el);
        }, 260);
      }
      return;
    }

    // A tap on a competency's header shows its tip, and a second tap hides it.
    var codeHead = e.target.closest('.gb-grid-tag-header');
    if (codeHead) {
      if (_tipSource === codeHead && _lastPointer !== 'mouse') _hideTip();
      else _showCodeTip(codeHead);
      return;
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
      clearSearch: function () {
        onSearch('', 0);
      },
      // Draft and Returned (S1-F1). The button is redrawn with the page, so
      // the new one takes the focus.
      toggleToReturn: function () {
        _flushActiveScoreEditor();
        _toReturnOnly = !_toReturnOnly;
        render();
        var again = document.querySelector('.gb-to-return');
        if (again) again.focus({ preventScroll: true });
      },
      // A Competencies header's Return N Graded: the button goes with the
      // drafts, so the assessment's title takes the focus.
      returnDrafts: function () {
        var aid = el.dataset.aid;
        if (!_returnDrafts(aid)) return;
        var title = Array.prototype.find.call(
          document.querySelectorAll('.gb-grid-assess-group .gb-assess-title'),
          function (t) {
            return (t.dataset.href || '').split('&open=')[1] === aid;
          },
        );
        if (title) title.focus({ preventScroll: true });
      },
      toggleSort: function () {
        toggleSort(el.dataset.sortkey);
      },
      editScoreCell: function () {
        openGrader(el.dataset.sid, el.dataset.aid, el);
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
        if (window.GradesPrint) GradesPrint.open(activeCourse, { shownIds: _printShownIds });
      },
      stopPropOnly: function () {
        /* just stop propagation */
      },
    };
    if (handlers[action]) {
      if (action !== 'stopPropOnly' && el.tagName !== 'SELECT') e.preventDefault();
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
    _toReturnOnly = false;
    _drafts = null;
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

    // What Class Results' buttons do here: Grade This Assessment opens the
    // grader on the top student shown; a change redraws the gradebook,
    // which redraws the panel.
    if (window.ClassResults)
      ClassResults.setPage(function () {
        return {
          beforeOpen: _hideTip,
          grade: function (aid) {
            var firstRow = document.querySelector('#gb-data tr[data-sid]');
            if (firstRow) openGrader(firstRow.dataset.sid, aid);
          },
          onChange: function () {
            clearProfCache();
            render();
          },
          markBlank: _markBlankCells,
        };
      });

    _addDocListener('pointerdown', function (e) {
      _lastPointer = e.pointerType || 'mouse';
    });
    _addDocListener('click', _handleClick);
    _addDocListener('contextmenu', function (e) {
      if (_graderOpen()) return;
      // Scores tab context menus
      var cell = e.target.closest('.gb-scores-cell');
      if (cell) {
        e.preventDefault();
        // From the keyboard the event has no pointer position: under the cell.
        if (!e.clientX && !e.clientY) {
          var r = cell.getBoundingClientRect();
          showScoreContextMenu({ clientX: r.left + r.width / 2, clientY: r.bottom }, cell);
        } else showScoreContextMenu(e, cell);
        return;
      }
      var header = e.target.closest('.gb-grid-colhead, .gb-scores-assess-head');
      // A slanted title acts on the column it leans along, not the box under the pointer.
      if (_inSlantedHeads(e.target)) {
        var hit = _slantedColAt(e.clientX, e.clientY);
        var onLabel = e.target.closest('.gb-grid-colhead-label');
        header = onLabel ? onLabel.closest('.gb-grid-colhead') : hit ? hit.el : null;
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
      clearTimeout(_headClickTimer);
      var el = e.target.closest('[data-action-dblclick]');
      if (_inSlantedHeads(e.target)) {
        var hit = _slantedColAt(e.clientX, e.clientY);
        var onLabel = e.target.closest('.gb-grid-colhead-label');
        el = onLabel ? onLabel.closest('.gb-grid-colhead') : hit ? hit.el : null;
      }
      if (!el) return;
      e.preventDefault();
      var action = el.dataset.actionDblclick;
      if (action === 'startScoreMode') enterScoreMode(el.dataset.aid);
    });
    _addDocListener('input', _handleInput);
    _addDocListener('change', _handleChange);
    _addDocListener('keydown', _handleKeydown);
    _addDocListener('keydown', _handleHeaderKeys);
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
    if (window.ClassResults) ClassResults.setPage(null);
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
