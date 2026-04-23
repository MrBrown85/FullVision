/* ── page-assignments.js — Assignments page module ─────────── */
window.PageAssignments = (function () {
  'use strict';

  /* ── Listener tracking for cleanup ──────────────────────── */
  var _listeners = [];
  function _addDocListener(type, handler, options) {
    document.addEventListener(type, handler, options);
    _listeners.push({ type: type, handler: handler, options: options });
  }

  /* ── State variables ────────────────────────────────────── */
  var activeCourse;
  var openAssessIds = new Set();
  var focusStudentParam = null;
  var _allExpanded = true;
  var _collapsedIds = new Set();
  var assessFilterType = 'all';
  var assessSearch = '';
  var showUngraded = false;
  var rubricViewStates = {};
  var _rubricsPanelOpen = false;
  var _advancedPanelOpen = false;
  var _showingNewForm = false;
  var _editingAssessId = null;
  var collapsedModules = {};
  var _dragAssessId = null;
  var _dragModuleId = null;
  var _dragSid = null;
  var _dragFromGroup = null;
  var _mergeTargetId = null;
  var collabPairMode = 'random';
  var collabGroupMode = 'random';
  var _mergeHoverTimer = null;
  var _mergeAnimating = false;
  var focusStudentId = null;
  var _searchTimer = null;
  // Collaboration delegation (now in assign-collab.js)
  var AC = AssignCollab;
  var newCollaboration; // alias for reads in save logic
  var collabExcluded, collabPairs, collabGroups, collabGroupCount;
  function _syncCollabState() {
    newCollaboration = AC.collaboration;
    collabExcluded = AC.excluded;
    collabPairs = AC.pairs;
    collabGroups = AC.groups;
    collabGroupCount = AC.groupCount;
  }
  function setCollaboration(mode) {
    AC.setCollaboration(mode);
    _syncCollabState();
  }
  function renderCollabPanel() {
    AC.renderCollabPanel();
  }
  function collabToggleStudent(sid, checked) {
    AC.collabToggleStudent(sid, checked);
  }
  function collabCheckAll() {
    AC.collabCheckAll();
  }
  function collabCheckNone() {
    AC.collabCheckNone();
  }
  function collabRandomPairs() {
    AC.collabRandomPairs();
    _syncCollabState();
  }
  function collabRandomGroups() {
    AC.collabRandomGroups();
    _syncCollabState();
  }
  function collabSetGroupCount(delta) {
    AC.collabSetGroupCount(delta);
    _syncCollabState();
  }
  function collabDragStart(e, sid, fromGroup) {
    AC.collabDragStart(e, sid, fromGroup);
  }
  function collabDrop(e, toGroup) {
    AC.collabDrop(e, toGroup);
    _syncCollabState();
  }
  function loadCollabData(assess) {
    AC.loadCollabData(assess);
    _syncCollabState();
  }
  function _resetCollabState() {
    AC.resetState();
    _syncCollabState();
  }

  // Rubric editor state
  var _editingRubric = null;
  var _rubricDirty = false;
  var _rubricAutoTags = [];
  var _critTagSection = {};
  var _expandedCriterion = 0;

  // Comment popover state
  var _commentPopoverState = null;

  // Keyboard navigation state
  var _kbFocusEl = null;

  // Status debounce
  var _statusDebounce = {};

  // Module colors
  var MODULE_COLORS = [
    '#6366f1',
    '#06b6d4',
    '#10b981',
    '#f59e0b',
    '#ef4444',
    '#8b5cf6',
    '#ec4899',
    '#14b8a6',
    '#f97316',
    '#64748b',
  ];
  var SECTION_COLORS = ['#3b82f6', '#0891b2', '#059669', '#9333ea', '#dc2626', '#ea580c', '#0284c7', '#4f46e5'];

  /* ── switchCourse ───────────────────────────────────────── */
  async function switchCourse(cid) {
    activeCourse = cid;
    setActiveCourse(cid);
    await initData(cid);
    assessFilterType = 'all';
    assessSearch = '';
    showUngraded = false;
    focusStudentId = null;
    collapsedModules = {};
    rubricViewStates = {};
    document.getElementById('sidebar-mount').innerHTML = renderSidebar(
      activeCourse,
      focusStudentId,
      'toggleFocusStudent',
    );
    render();
  }

  /* ── Focus Student ─────────────────────────────────────── */
  function toggleFocusStudent(sid) {
    if (focusStudentId === sid) {
      focusStudentId = null;
      openAssessIds.clear();
      _allExpanded = true;
      _collapsedIds.clear();
    } else if (!focusStudentId) {
      focusStudentId = sid;
      openAssessIds.clear();
      _allExpanded = true;
      _collapsedIds.clear();
    } else {
      focusStudentId = sid;
    }
    document.getElementById('sidebar-mount').innerHTML = renderSidebar(
      activeCourse,
      focusStudentId,
      'toggleFocusStudent',
    );
    render();
  }

  function clearFocusStudent() {
    focusStudentId = null;
    openAssessIds.clear();
    _allExpanded = true;
    _collapsedIds.clear();
    document.getElementById('sidebar-mount').innerHTML = renderSidebar(
      activeCourse,
      focusStudentId,
      'toggleFocusStudent',
    );
    render();
  }

  /* ── Assessment Filters ────────────────────────────────── */
  function setAssessTypeFilter(val) {
    assessFilterType = val;
    render();
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

  function setAssessSearch(val) {
    assessSearch = (val || '').trim();
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(function () {
      render();
      var inp = document.querySelector('.assess-search-input');
      if (inp) {
        inp.focus();
        inp.setSelectionRange(inp.value.length, inp.value.length);
      }
    }, 200);
  }

  /* ── Toolbar ────────────────────────────────────────────── */
  function renderAssessToolbar(cid, method, dw, assessments) {
    var courseOptions = Object.values(COURSES)
      .map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === cid ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      })
      .join('');

    var toolbarHtml =
      '<div class="assess-toolbar">' +
      '<select class="assess-course-select" data-action="assessSwitchCourse" aria-label="Select course">' +
      courseOptions +
      '</select>' +
      '<div class="assess-seg-control" role="tablist" aria-label="Assessment category filter">' +
      '<button class="assess-seg-btn' +
      (assessFilterType === 'all' ? ' active' : '') +
      '" data-action="setAssessTypeFilter" data-type="all" role="tab" aria-selected="' +
      (assessFilterType === 'all') +
      '">All</button>' +
      '<button class="assess-seg-btn' +
      (assessFilterType === 'categorized' ? ' active' : '') +
      '" data-action="setAssessTypeFilter" data-type="categorized" role="tab" aria-selected="' +
      (assessFilterType === 'categorized') +
      '">Categorized</button>' +
      '<button class="assess-seg-btn' +
      (assessFilterType === 'uncategorized' ? ' active' : '') +
      '" data-action="setAssessTypeFilter" data-type="uncategorized" role="tab" aria-selected="' +
      (assessFilterType === 'uncategorized') +
      '">No Category</button>' +
      '</div>' +
      '<button class="assess-ungraded-chip' +
      (showUngraded ? ' active' : '') +
      '" data-action="toggleUngraded" aria-pressed="' +
      showUngraded +
      '" aria-label="Show ungraded assessments only">\u26A0 Ungraded</button>' +
      '<div class="assess-search-wrap">' +
      '<span class="assess-search-icon" aria-hidden="true">\uD83D\uDD0D</span>' +
      '<input class="assess-search-input" type="text" placeholder="Search\u2026" value="' +
      esc(assessSearch) +
      '" data-action-input="assessSearch" aria-label="Search assessments">' +
      '</div>' +
      '<div class="assess-seg-control" style="margin-left:4px">' +
      '<button class="assess-seg-btn' +
      ((
        focusStudentId
          ? _allExpanded && _collapsedIds.size === 0
          : openAssessIds.size > 0 && openAssessIds.size >= getAssessments(activeCourse).length
      )
        ? ' active'
        : '') +
      '" data-action="expandAllAssess">Expand</button>' +
      '<button class="assess-seg-btn' +
      ((focusStudentId ? !_allExpanded && openAssessIds.size === 0 : openAssessIds.size === 0) ? ' active' : '') +
      '" data-action="collapseAllAssess">Collapse</button>' +
      '</div>' +
      (focusStudentId
        ? '<button class="tb-action-btn tb-show-all-btn" data-action="clearFocusStudent">Show All Students</button>'
        : '') +
      '<div class="assess-toolbar-actions">' +
      '<div class="tb-dropdown-wrap">' +
      '<button class="tb-dropdown-btn' +
      (_advancedPanelOpen ? ' open' : '') +
      '" data-action="toggleToolbarDropdown" data-panel="advanced">Advanced</button>' +
      '<div class="tb-dropdown-panel' +
      (_advancedPanelOpen ? ' open' : '') +
      '" id="tb-advanced-panel"></div>' +
      '<div class="tb-dropdown-panel' +
      (_rubricsPanelOpen ? ' open' : '') +
      '" id="tb-rubrics-panel"></div>' +
      '</div>' +
      '<button class="tb-action-btn" data-action="showNewForm">+ New Assessment</button>' +
      '</div>' +
      '</div>';

    // Focus banner when grading a single student
    if (focusStudentId) {
      var focusSt = getStudents(cid).find(function (s) {
        return s.id === focusStudentId;
      });
      if (focusSt) {
        toolbarHtml +=
          '<div class="focus-banner">' +
          '<span class="focus-banner-label">Grading: <strong>' +
          esc(focusSt.firstName) +
          ' ' +
          esc(focusSt.lastName) +
          '</strong></span>' +
          '</div>';
      }
    }

    // Rubrics dropdown content
    var rubrics = getRubrics(cid);
    var rubHtml = '<div class="settings-title">Rubrics</div><ul class="rubric-list">';
    if (rubrics.length === 0) {
      rubHtml += '<li style="font-size:0.82rem;color:var(--text-3);padding:8px 10px">No rubrics yet.</li>';
    }
    rubrics.forEach(function (r) {
      rubHtml +=
        '<li class="rubric-list-item">' +
        '<span class="rubric-list-name">' +
        esc(r.name) +
        '</span>' +
        '<span class="rubric-list-count">' +
        r.criteria.length +
        ' criteria</span>' +
        '<button class="rubric-list-btn" data-action="editRubricUI" data-rid="' +
        r.id +
        '" title="Edit">\u270E</button>' +
        '<button class="rubric-list-btn delete" data-action="deleteRubricUI" data-rid="' +
        r.id +
        '" title="Delete" aria-label="Delete rubric">\u2715</button>' +
        '</li>';
    });
    rubHtml +=
      '</ul><button class="lo-add-btn" data-action="newRubricUI" style="display:block;width:100%">+ New Rubric</button>';

    // Advanced dropdown content
    var advHtml =
      '<div class="settings-row"><label>Rubrics</label><button class="btn btn-primary" data-action="openRubricPanel">Rubric Bank</button></div>' +
      '<div class="settings-title">Calculation</div>' +
      '<div class="settings-row"><label>Method</label><select class="form-input" style="width:auto" data-action-change="updateCalcMethod"><option value="mostRecent"' +
      (method === 'mostRecent' ? ' selected' : '') +
      '>Most Recent</option><option value="highest"' +
      (method === 'highest' ? ' selected' : '') +
      '>Highest</option><option value="mode"' +
      (method === 'mode' ? ' selected' : '') +
      '>Mode</option><option value="decayingAvg"' +
      (method === 'decayingAvg' ? ' selected' : '') +
      '>Decaying Average</option></select></div>' +
      '<div id="decay-row" style="display:' +
      (method === 'decayingAvg' ? 'flex' : 'none') +
      '" class="settings-row"><label>Weight: <span id="decay-val">' +
      (dw * 100).toFixed(0) +
      '%</span></label><input type="range" min="0" max="100" value="' +
      (dw * 100).toFixed(0) +
      '" data-action-input="updateDecaySlider"></div>' +
      renderGradingScaleEditor(cid) +
      renderCategoryWeightsEditor(cid) +
      '<div class="settings-title" style="margin-top:16px;padding-top:12px;border-top:0.5px solid var(--divider-subtle)">Data</div>' +
      '<div class="settings-row"><label>Export</label><button class="btn btn-primary" data-action="exportData">JSON</button></div>' +
      '<div class="settings-row"><label>Export Scores</label><button class="btn btn-primary" data-action="exportScoresCSV">Export Scores CSV</button></div>' +
      '<div class="settings-row"><label>Export Summary</label><button class="btn btn-primary" data-action="exportSummaryCSV">Export Summary CSV</button></div>' +
      '<div class="settings-row"><label>Import JSON</label><button class="btn btn-primary" data-action="triggerImportJSON">Import JSON</button><input type="file" id="import-json-input" accept=".json" data-action-change="importDataFile" style="display:none"></div>' +
      '<div class="settings-row"><label>Delete class</label><button class="btn btn-danger" data-action="clearData">Delete</button></div>' +
      '<div class="settings-title" style="margin-top:16px;padding-top:12px;border-top:0.5px solid var(--divider-subtle)">Demo</div>' +
      '<div class="settings-row"><label>Reset to demo data</label><button class="btn btn-danger" data-action="resetDemoData">Reset Demo</button></div>';

    return { toolbarHtml: toolbarHtml, rubHtml: rubHtml, advHtml: advHtml };
  }

  /* ── Assessment List ────────────────────────────────────── */
  function renderAssessmentList(cid, assessments, allAssessments, students, scores, modules) {
    var html =
      '<div class="settings-grid" style="display:grid;grid-template-columns:1fr;gap:20px;align-items:start;padding:16px 20px">';
    html += '<div>';

    // New assessment form
    html +=
      '<div id="new-assess-form" style="display:' +
      (_showingNewForm ? 'block' : 'none') +
      ';background:var(--surface);border:2px solid var(--active);border-radius:var(--radius);padding:24px;margin-bottom:16px;box-shadow:0 4px 20px rgba(0,122,255,0.12)">' +
      (_showingNewForm
        ? renderAssessForm(
            cid,
            _editingAssessId
              ? getAssessments(cid).find(function (a) {
                  return a.id === _editingAssessId;
                })
              : null,
          )
        : '') +
      '</div>';

    // Assessment cards grouped by module folders
    function renderAssessCard(a, isUncategorized) {
      var isOpen = focusStudentId
        ? _allExpanded
          ? !_collapsedIds.has(a.id)
          : openAssessIds.has(a.id)
        : openAssessIds.has(a.id);
      var tagObjs = (a.tagIds || [])
        .map(function (tid) {
          return getTagById(cid, tid);
        })
        .filter(Boolean);
      var categoryId = _getAssessmentCategoryId(a);
      var categoryName = _getCategoryName(cid, categoryId);
      var c =
        '<div class="assess-card' +
        (isOpen ? ' open active' : '') +
        '" id="ac-' +
        a.id +
        '" draggable="true"' +
        ' data-assess-drag="' +
        a.id +
        '"' +
        (isUncategorized ? ' data-assess-card-drop="' + a.id + '"' : '') +
        '>' +
        '<div class="assess-header" data-action="toggleAssess" data-aid="' +
        a.id +
        '">' +
        '<span class="type-badge ' +
        (categoryId ? 'type-badge-s' : 'type-badge-f') +
        '">' +
        esc(categoryName) +
        '</span>' +
        '<div class="assess-header-info">' +
        '<span class="assess-title">' +
        esc(a.title) +
        '</span>' +
        '<span class="assess-meta">' +
        (a.rubricId
          ? (function () {
              var r = getRubricById(cid, a.rubricId);
              return r ? '<span class="rubric-badge">\uD83D\uDCCB ' + esc(r.name) + '</span>' : '';
            })()
          : '') +
        (a.coreCompetencyIds || [])
          .map(function (ccId) {
            var cc = getCoreCompetency(ccId);
            return cc
              ? '<span class="cc-badge" title="' +
                  esc(cc.label) +
                  '" style="border-color:' +
                  cc.color +
                  ';color:' +
                  cc.color +
                  '">' +
                  esc(cc.id) +
                  '</span>'
              : '';
          })
          .join('') +
        (a.collaboration && a.collaboration !== 'individual'
          ? '<span class="collab-badge">\uD83D\uDC65 ' +
            a.collaboration[0].toUpperCase() +
            a.collaboration.slice(1) +
            '</span>'
          : '') +
        '<span class="assess-date">' +
        (a.dateAssigned ? formatDate(a.dateAssigned) + ' \u2192 ' : '') +
        formatDate(a.date) +
        '</span>' +
        (function () {
          if (a.dueDate) {
            var isPastDue = new Date(a.dueDate) < new Date();
            if (isPastDue) {
              var unscoredCount = students.filter(function (st) {
                var sc = scores[st.id] || [];
                return !sc.some(function (s) {
                  return s.assessmentId === a.id && s.score > 0;
                });
              }).length;
              if (unscoredCount > 0)
                return (
                  "<span style=\"font-family:'SF Mono', ui-monospace, 'Menlo', monospace;font-size:0.6rem;color:var(--priority);margin-left:6px\" title=\"" +
                  unscoredCount +
                  ' students unscored past due date">\u26A0 ' +
                  unscoredCount +
                  ' missing</span>'
                );
            }
          }
          return '';
        })() +
        '</span>' +
        '</div>' +
        '<div class="assess-header-actions" data-stop-prop="true">' +
        (a.rubricId && getRubricById(cid, a.rubricId)
          ? (function () {
              var showRubric = rubricViewStates[a.id] !== undefined ? rubricViewStates[a.id] : true;
              return (
                '<div class="rubric-view-toggle">' +
                '<button class="rubric-view-btn' +
                (!showRubric ? ' active' : '') +
                '" data-action="setRubricView" data-aid="' +
                a.id +
                '" data-rubric="false">Tags</button>' +
                '<button class="rubric-view-btn' +
                (showRubric ? ' active' : '') +
                '" data-action="setRubricView" data-aid="' +
                a.id +
                '" data-rubric="true">Rubric</button>' +
                '</div>'
              );
            })()
          : '') +
        '<button class="assess-header-action-btn" data-action="editAssess" data-aid="' +
        a.id +
        '" title="Edit">\u270F\uFE0F</button>' +
        '<button class="assess-header-action-btn" data-action="dupeAssess" data-aid="' +
        a.id +
        '" title="Duplicate">\uD83D\uDCC4</button>' +
        '<button class="assess-header-action-btn action-delete" data-action="deleteAssess" data-aid="' +
        a.id +
        '" title="Delete assessment" aria-label="Delete assessment">\uD83D\uDDD1\uFE0F</button>' +
        '</div>' +
        '<span class="assess-chevron">' +
        (isOpen ? '\u25BE' : '\u25B8') +
        '</span>' +
        '</div>' +
        '<div class="assess-body">' +
        (a.description
          ? '<div style="font-size:0.88rem;color:var(--text-2);margin:8px 0 12px;line-height:1.5;padding:10px 14px;background:var(--bg);border-radius:var(--radius-sm)">' +
            esc(a.description) +
            '</div>'
          : '') +
        (function () {
          var gridStudents = focusStudentId
            ? students.filter(function (st) {
                return st.id === focusStudentId;
              })
            : students;
          return a.scoreMode === 'points'
            ? renderPointsGrid(cid, a, gridStudents, scores)
            : a.rubricId && getRubricById(cid, a.rubricId)
              ? (function () {
                  var showRubric = rubricViewStates[a.id] !== undefined ? rubricViewStates[a.id] : true;
                  return showRubric
                    ? renderRubricGradingView(cid, a, gridStudents, scores)
                    : renderTagGrid(cid, a, tagObjs, gridStudents, scores);
                })()
              : renderTagGrid(cid, a, tagObjs, gridStudents, scores);
        })() +
        '</div>' +
        '</div>';
      return c;
    }

    // Group assessments by module
    var grouped = {};
    modules.forEach(function (u) {
      grouped[u.id] = [];
    });
    grouped['__none__'] = [];
    assessments.forEach(function (a) {
      var key = a.moduleId && grouped[a.moduleId] ? a.moduleId : '__none__';
      grouped[key].push(a);
    });

    var filtersActive = assessFilterType !== 'all' || showUngraded || !!assessSearch;

    // Render module folders with drop zones
    modules.forEach(function (u, idx) {
      var items = grouped[u.id];
      if (filtersActive && items.length === 0) return;
      var isOpen = !collapsedModules[u.id];
      var containsOpen =
        openAssessIds.size > 0 &&
        items.some(function (a) {
          return openAssessIds.has(a.id);
        });
      var folderOpen = isOpen || containsOpen;
      html += '<div class="mod-drop-zone" data-drop-index="' + idx + '" data-mod-drop-zone="true"></div>';
      html +=
        '<div class="mod-folder' +
        (folderOpen ? ' open' : '') +
        '" data-module-id="' +
        u.id +
        '" draggable="true" data-module-drag="' +
        u.id +
        '" data-folder-drop="' +
        u.id +
        '">' +
        '<div class="mod-folder-header" data-action="toggleModuleFolder" data-uid="' +
        u.id +
        '">' +
        '<span class="mod-folder-grip">\u2807</span>' +
        '<span class="mod-folder-chevron">\u25B6</span>' +
        '<span class="mod-folder-color" style="background:' +
        (u.color || '#6366f1') +
        '" title="Change color" data-action="openColorPicker" data-stop-prop="true">' +
        '<input type="color" value="' +
        (u.color || '#6366f1') +
        '" data-action-change="moduleColor" data-moduleid="' +
        u.id +
        '">' +
        '</span>' +
        '<input class="mod-folder-name-input" value="' +
        esc(u.name) +
        '" draggable="false"' +
        ' data-stop-prop="true" data-action-blur="moduleName" data-moduleid="' +
        u.id +
        '">' +
        '<span class="mod-folder-meta">' +
        items.length +
        ' assignment' +
        (items.length !== 1 ? 's' : '') +
        '</span>' +
        '<div class="mod-folder-actions" data-stop-prop="true">' +
        '<button class="mod-folder-action delete" data-action="deleteModule" data-uid="' +
        u.id +
        '" data-count="' +
        items.length +
        '" title="Delete module">\u2715</button>' +
        '</div>' +
        '</div>' +
        '<div class="mod-folder-body">' +
        (items.length > 0
          ? items
              .map(function (a) {
                return renderAssessCard(a);
              })
              .join('')
          : '<div class="mod-folder-empty">Drop assignments here or create a new one</div>') +
        '</div>' +
        '</div>';
    });
    if (modules.length > 0) {
      html += '<div class="mod-drop-zone" data-drop-index="' + modules.length + '" data-mod-drop-zone="true"></div>';
    }

    // Ungrouped assessments
    var ungrouped = grouped['__none__'];
    if (modules.length === 0) {
      ungrouped.forEach(function (a) {
        html += renderAssessCard(a, true);
      });
    } else if (filtersActive && ungrouped.length === 0) {
      // hide
    } else {
      var noModOpen = !collapsedModules['__none__'];
      var containsOpenNoMod =
        openAssessIds.size > 0 &&
        ungrouped.some(function (a) {
          return openAssessIds.has(a.id);
        });
      var folderOpen = (ungrouped.length > 0 && noModOpen) || containsOpenNoMod;
      html +=
        '<div class="mod-folder no-module' +
        (folderOpen ? ' open' : '') +
        (ungrouped.length === 0 ? ' empty-target' : '') +
        '" data-module-id="__none__" data-folder-drop="__none__">' +
        '<div class="mod-folder-header" data-action="toggleModuleFolder" data-uid="__none__">' +
        '<span class="mod-folder-chevron">\u25B6</span>' +
        '<span style="font-size:0.88rem;color:var(--text-3)">\uD83D\uDCC1</span>' +
        '<span class="mod-folder-name" style="font-size:0.95rem;font-weight:500;color:var(--text-3)">Unassigned</span>' +
        '<span class="mod-folder-meta">' +
        ungrouped.length +
        ' assignment' +
        (ungrouped.length !== 1 ? 's' : '') +
        '</span>' +
        '</div>' +
        '<div class="mod-folder-body">' +
        (ungrouped.length > 0
          ? ungrouped
              .map(function (a) {
                return renderAssessCard(a, true);
              })
              .join('')
          : '<div class="mod-folder-empty">Drop assignments here to unassign from a module</div>') +
        '</div>' +
        '</div>';
    }

    html += '<button class="add-module-btn" data-action="addModuleInline">+ Add Module</button>';

    if (assessments.length === 0 && allAssessments.length > 0) {
      html +=
        '<div style="text-align:center;color:var(--text-3);padding:40px 0">' +
        '<div style="font-size:1.2rem;margin-bottom:6px;opacity:0.4">\uD83D\uDCCB</div>' +
        '<div style="font-size:0.88rem;margin-bottom:4px">No matching assignments.</div>' +
        '<div style="font-size:0.78rem">Try adjusting your filters or <a href="#" data-action="clearAssessFilters" style="color:var(--active)">clear all filters</a>.</div>' +
        '</div>';
    } else if (assessments.length === 0 && allAssessments.length === 0) {
      html +=
        '<div class="empty-state">' +
        '<div class="empty-state-icon">\uD83D\uDCDD</div>' +
        '<div class="empty-state-title">No assignments yet</div>' +
        '<div class="empty-state-text">Create your first assignment to start grading.</div>' +
        '</div>';
    }
    html += '</div>';
    html += '</div>';
    return html;
  }

  /* ── Main render ────────────────────────────────────────── */
  function render() {
    var cid = activeCourse;
    var course = COURSES[cid];
    if (!course) return;
    var cc = getCourseConfig(cid);
    var method = cc.calcMethod || course.calcMethod || 'mostRecent';
    var dw = cc.decayWeight != null ? cc.decayWeight : course.decayWeight || 0.65;
    var sections = getSections(cid);
    var allAssessments = getAssessments(cid)
      .slice()
      .sort(function (a, b) {
        return (b.date || '').localeCompare(a.date || '');
      });
    var students = sortStudents(getStudents(cid), 'lastName');
    var scores = getScores(cid);
    var modules = getModules(cid);

    // Apply filters
    var assessments = allAssessments;
    if (assessFilterType === 'categorized') {
      assessments = assessments.filter(function (a) {
        return !!_getAssessmentCategoryId(a);
      });
    } else if (assessFilterType === 'uncategorized') {
      assessments = assessments.filter(function (a) {
        return !_getAssessmentCategoryId(a);
      });
    }
    if (assessSearch) {
      var q = assessSearch.toLowerCase();
      assessments = assessments.filter(function (a) {
        return (
          (a.title || '').toLowerCase().includes(q) ||
          (a.description || '').toLowerCase().includes(q) ||
          (a.tagIds || []).some(function (tid) {
            var tag = getTagById(cid, tid);
            return tid.toLowerCase().includes(q) || (tag && tag.label.toLowerCase().includes(q));
          }) ||
          (a.moduleId &&
            (function () {
              var mod = getModuleById(cid, a.moduleId);
              return mod && mod.name.toLowerCase().includes(q);
            })())
        );
      });
    }
    if (showUngraded) {
      assessments = assessments.filter(function (a) {
        return students.some(function (st) {
          var sc = scores[st.id] || [];
          return !(a.tagIds || []).every(function (tid) {
            return sc.some(function (s) {
              return s.assessmentId === a.id && s.tagId === tid && s.score > 0;
            });
          });
        });
      });
    }

    // Render toolbar
    var result = renderAssessToolbar(cid, method, dw, assessments);
    document.getElementById('page-toolbar-mount').innerHTML = result.toolbarHtml;
    var rubPanel = document.getElementById('tb-rubrics-panel');
    var advPanel = document.getElementById('tb-advanced-panel');
    if (rubPanel) rubPanel.innerHTML = result.rubHtml;
    if (advPanel) advPanel.innerHTML = result.advHtml;

    // Render assessment list
    document.getElementById('main').innerHTML = renderAssessmentList(
      cid,
      assessments,
      allAssessments,
      students,
      scores,
      modules,
    );

    // Show/hide descriptor bar
    var hasActiveRubricView = false;
    if (openAssessIds.size > 0 || (focusStudentId && _allExpanded)) {
      var checkIds =
        focusStudentId && _allExpanded
          ? assessments.map(function (a) {
              return a.id;
            })
          : Array.from(openAssessIds);
      hasActiveRubricView = checkIds.some(function (aid) {
        if (focusStudentId && _allExpanded && _collapsedIds.has(aid)) return false;
        var a = assessments.find(function (x) {
          return x.id === aid;
        });
        return (
          a &&
          a.rubricId &&
          getRubricById(cid, a.rubricId) &&
          (rubricViewStates[a.id] !== undefined ? rubricViewStates[a.id] : true)
        );
      });
    }
    if (hasActiveRubricView) showDescriptorBar();
    else hideDescriptorBar();
  }

  /* ── Assessment Form ────────────────────────────────────── */
  function renderAssessForm(cid, assess) {
    var sections = getSections(cid);
    var isEdit = !!assess;
    var title = assess ? assess.title : '';
    var dateAssigned = assess ? assess.dateAssigned || assess.date || '' : new Date().toISOString().slice(0, 10);
    var dateDue = assess ? assess.date || '' : new Date().toISOString().slice(0, 10);
    var dueDate = assess ? assess.dueDate || '' : '';
    var categoryId = _getAssessmentCategoryId(assess);
    var selTags = assess ? assess.tagIds || [] : [];
    var evidence = assess ? assess.evidenceType : 'written';
    var description = assess ? assess.description || '' : '';
    var moduleId = assess ? assess.moduleId || '' : '';
    var collaboration = assess ? assess.collaboration || 'individual' : 'individual';
    AC.collaboration = collaboration;
    newCollaboration = collaboration;
    var allModules = getModules(cid);
    var categories = _getSortedCategories(cid);
    var scoreMode = assess ? assess.scoreMode || 'proficiency' : 'proficiency';
    var maxPoints = assess ? assess.maxPoints || 100 : 100;
    var weight = assess ? assess.weight || 1 : 1;

    var html = '';

    // Title
    html +=
      '<div class="af-field">' +
      '<label class="af-label">Assignment Title</label>' +
      '<input class="af-input" id="af-title" type="text" value="' +
      esc(title) +
      '" placeholder="e.g. Persuasive Essay \u2014 Rights & Freedoms">' +
      '</div>';

    // Description
    html +=
      '<div class="af-field">' +
      '<label class="af-label">Description</label>' +
      '<textarea class="af-textarea" id="af-desc" rows="1" placeholder="Describe the assignment, expectations, and criteria\u2026">' +
      esc(description) +
      '</textarea>' +
      '</div>';

    // Rubric selector
    var rubricsList = getRubrics(cid);
    var selRubricId = assess ? assess.rubricId || '' : '';
    html +=
      '<div class="af-field">' +
      '<label class="af-label">Rubric</label>' +
      '<div style="display:flex;gap:8px;align-items:center">' +
      '<select class="af-rubric-select" id="af-rubric" data-action-change="onRubricSelect" style="flex:1">' +
      '<option value="">None</option>' +
      rubricsList
        .map(function (r) {
          return (
            '<option value="' +
            r.id +
            '"' +
            (r.id === selRubricId ? ' selected' : '') +
            '>' +
            esc(r.name) +
            ' (' +
            r.criteria.length +
            ' criteria)</option>'
          );
        })
        .join('') +
      '</select>' +
      '<button type="button" class="btn btn-ghost" data-action="newRubricFromForm" style="white-space:nowrap;font-size:0.78rem;padding:7px 12px">+ New Rubric</button>' +
      '</div>' +
      (selRubricId
        ? '<div class="af-rubric-info">Rubric tags are auto-selected below. You can add additional tags.</div>'
        : '') +
      '</div>';

    // Dates
    var today = new Date().toISOString().slice(0, 10);
    var defaultDue =
      dueDate ||
      (function () {
        var d = new Date((dateAssigned || today) + 'T12:00:00');
        d.setDate(d.getDate() + 7);
        return d.toISOString().slice(0, 10);
      })();
    var todayFormatted = new Date(today + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    html +=
      '<div class="af-row" style="align-items:end">' +
      '<div class="af-field" style="flex:0 0 auto">' +
      '<label class="af-label">Today\'s Date</label>' +
      '<div style="font-family:var(--font-base);font-size:0.88rem;font-weight:500;color:var(--text);padding:8px 0;white-space:nowrap">' +
      todayFormatted +
      '</div>' +
      '</div>' +
      '<div class="af-field" style="flex:1;max-width:200px">' +
      '<label class="af-label">Date Assigned</label>' +
      '<input class="af-input" id="af-date-assigned" type="date" value="' +
      dateAssigned +
      '" data-action-change="autoSetDueDate">' +
      '</div>' +
      '<div class="af-field" style="flex:1;max-width:200px">' +
      '<label class="af-label">Due Date (optional)</label>' +
      '<input class="af-input" id="af-due" type="date" value="' +
      defaultDue +
      '">' +
      '</div>' +
      '</div>';

    // Category, Evidence, Collaboration, Module
    html +=
      '<div class="af-row">' +
      '<div class="af-field" style="flex:1">' +
      '<label class="af-label">Category</label>' +
      '<select class="af-input" id="af-category">' +
      '<option value="">No Category</option>' +
      categories
        .map(function (category) {
          return (
            '<option value="' +
            category.id +
            '"' +
            (category.id === categoryId ? ' selected' : '') +
            '>' +
            esc(category.name) +
            '</option>'
          );
        })
        .join('') +
      '</select>' +
      (categories.length === 0
        ? '<div class="af-rubric-info">No grading categories configured for this course yet.</div>'
        : '') +
      '</div>' +
      '<div class="af-field" style="flex:1">' +
      '<label class="af-label">Evidence Type</label>' +
      '<select class="af-input" id="af-evidence">' +
      ['written', 'observation', 'audio', 'video', 'photo', 'conversation']
        .map(function (t) {
          return (
            '<option value="' +
            t +
            '"' +
            (t === evidence ? ' selected' : '') +
            '>' +
            t[0].toUpperCase() +
            t.slice(1) +
            '</option>'
          );
        })
        .join('') +
      '</select>' +
      '</div>' +
      '<div class="af-field" style="flex:1.3;min-width:210px">' +
      '<label class="af-label">Collaboration</label>' +
      '<div class="af-type-toggle">' +
      '<button class="af-type-btn af-collab-btn' +
      (collaboration === 'individual' ? ' active' : '') +
      '" data-collab="individual" data-action="setCollaboration">Individual</button>' +
      '<button class="af-type-btn af-collab-btn' +
      (collaboration === 'pair' ? ' active' : '') +
      '" data-collab="pair" data-action="setCollaboration">Pair</button>' +
      '<button class="af-type-btn af-collab-btn' +
      (collaboration === 'group' ? ' active' : '') +
      '" data-collab="group" data-action="setCollaboration">Group</button>' +
      '</div>' +
      '</div>' +
      '<div class="af-field" style="flex:1">' +
      '<label class="af-label">Module</label>' +
      '<select class="af-input" id="af-module">' +
      '<option value="">No Module</option>' +
      allModules
        .map(function (u) {
          return (
            '<option value="' + u.id + '"' + (u.id === moduleId ? ' selected' : '') + '>' + esc(u.name) + '</option>'
          );
        })
        .join('') +
      '</select>' +
      '</div>' +
      '</div>' +
      '<div id="collab-panel-mount"></div>';

    // Scoring mode & weight
    html +=
      '<div class="af-row" style="align-items:end">' +
      '<div class="af-field" style="flex:0 0 auto">' +
      '<label class="af-label">Scoring Mode</label>' +
      '<input type="hidden" id="af-scoremode" value="' +
      scoreMode +
      '">' +
      '<div class="af-type-toggle">' +
      '<button type="button" class="af-type-btn af-scoremode-btn' +
      (scoreMode === 'proficiency' ? ' active' : '') +
      '" data-mode="proficiency" data-action="setScoreMode">Proficiency</button>' +
      '<button type="button" class="af-type-btn af-scoremode-btn' +
      (scoreMode === 'points' ? ' active' : '') +
      '" data-mode="points" data-action="setScoreMode">Points</button>' +
      '</div>' +
      '</div>' +
      '<div class="af-field" id="af-maxpoints-wrap" style="flex:0 0 auto;' +
      (scoreMode === 'points' ? '' : 'display:none') +
      '">' +
      '<label class="af-label">Max Points</label>' +
      '<div style="display:flex;gap:6px;align-items:center">' +
      '<input class="af-input" id="af-maxpoints" type="number" min="1" max="9999" value="' +
      maxPoints +
      '" style="width:80px;text-align:center">' +
      '<div id="af-maxpoints-picks" style="display:flex;gap:4px">' +
      [10, 25, 50, 100]
        .map(function (v) {
          return (
            '<button type="button" class="af-chip' +
            (maxPoints === v ? ' active' : '') +
            '" data-action="setMaxPoints" data-value="' +
            v +
            '" style="padding:4px 8px;font-size:0.72rem;border-radius:6px;border:1px solid var(--border);background:' +
            (maxPoints === v ? 'var(--primary)' : 'var(--bg-2)') +
            ';color:' +
            (maxPoints === v ? '#fff' : 'var(--text-2)') +
            ';cursor:pointer">' +
            v +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="af-field" style="flex:0 0 auto">' +
      '<label class="af-label">Weight</label>' +
      '<select class="af-input" id="af-weight" style="width:80px">' +
      [0.5, 1, 1.5, 2, 3]
        .map(function (w) {
          return '<option value="' + w + '"' + (w === weight ? ' selected' : '') + '>' + w + 'x</option>';
        })
        .join('') +
      '</select>' +
      '</div>' +
      '</div>';

    // Tags — grouped by competency group
    html +=
      '<div class="af-field">' +
      '<label class="af-label">Curricular Competencies</label>' +
      '<div class="af-tags-container">';
    var lm = getLearningMap(cid);
    var compGroups = (lm && lm.competencyGroups) || [];
    if (compGroups.length > 0) {
      // Build grouped + ungrouped lists
      var _afGroupMap = {};
      compGroups.forEach(function (g) {
        _afGroupMap[g.id] = { group: g, secs: [] };
      });
      var _afUngrouped = [];
      sections.forEach(function (sec) {
        if (sec.groupId && _afGroupMap[sec.groupId]) _afGroupMap[sec.groupId].secs.push(sec);
        else _afUngrouped.push(sec);
      });
      compGroups.forEach(function (g) {
        var gi = _afGroupMap[g.id];
        if (gi.secs.length === 0) return;
        html +=
          '<div style="margin-bottom:8px"><div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
          '<span style="width:8px;height:8px;border-radius:50%;background:' +
          g.color +
          ';flex-shrink:0"></span>' +
          '<span style="font-size:var(--text-xs);font-weight:600;color:var(--text-2);text-transform:uppercase;letter-spacing:var(--tracking-wide)">' +
          esc(g.name) +
          '</span></div>';
        gi.secs.forEach(function (sec) {
          var tag = sec.tags[0];
          if (!tag) return;
          var checked = selTags.includes(tag.id);
          html +=
            '<label class="af-tag-item' +
            (checked ? ' checked' : '') +
            '" data-section="' +
            sec.id +
            '" style="border-left:3px solid ' +
            sec.color +
            ';padding-left:8px;margin-bottom:4px">' +
            '<input type="checkbox" value="' +
            tag.id +
            '" class="af-tag-cb" data-section="' +
            sec.id +
            '"' +
            (checked ? ' checked' : '') +
            ' data-action-change="tagCheckbox">' +
            '<span class="af-tag-id" style="color:' +
            sec.color +
            '">' +
            esc(tag.id) +
            '</span>' +
            '<span class="af-tag-name">' +
            esc(sec.name) +
            '</span>' +
            '</label>';
        });
        html += '</div>';
      });
      _afUngrouped.forEach(function (sec) {
        var tag = sec.tags[0];
        if (!tag) return;
        var checked = selTags.includes(tag.id);
        html +=
          '<label class="af-tag-item' +
          (checked ? ' checked' : '') +
          '" data-section="' +
          sec.id +
          '" style="border-left:3px solid ' +
          sec.color +
          ';padding-left:8px;margin-bottom:4px">' +
          '<input type="checkbox" value="' +
          tag.id +
          '" class="af-tag-cb" data-section="' +
          sec.id +
          '"' +
          (checked ? ' checked' : '') +
          ' data-action-change="tagCheckbox">' +
          '<span class="af-tag-id" style="color:' +
          sec.color +
          '">' +
          esc(tag.id) +
          '</span>' +
          '<span class="af-tag-name">' +
          esc(sec.name) +
          '</span>' +
          '</label>';
      });
    } else {
      // No groups — flat list
      sections.forEach(function (sec) {
        var tag = sec.tags[0];
        if (!tag) return;
        var checked = selTags.includes(tag.id);
        html +=
          '<label class="af-tag-item' +
          (checked ? ' checked' : '') +
          '" data-section="' +
          sec.id +
          '" style="border-left:3px solid ' +
          sec.color +
          ';padding-left:8px;margin-bottom:4px">' +
          '<input type="checkbox" value="' +
          tag.id +
          '" class="af-tag-cb" data-section="' +
          sec.id +
          '"' +
          (checked ? ' checked' : '') +
          ' data-action-change="tagCheckbox">' +
          '<span class="af-tag-id" style="color:' +
          sec.color +
          '">' +
          esc(tag.id) +
          '</span>' +
          '<span class="af-tag-name">' +
          esc(sec.name) +
          '</span>' +
          '</label>';
      });
    }
    html += '</div></div>';

    // Core Competencies
    var selCC = assess ? assess.coreCompetencyIds || [] : [];
    html +=
      '<div class="af-field">' + '<label class="af-label">Core Competencies</label>' + '<div class="af-cc-chips">';
    CORE_COMPETENCIES.forEach(function (cc) {
      var sel = selCC.includes(cc.id);
      html +=
        '<button type="button" class="af-cc-chip' +
        (sel ? ' active' : '') +
        '" data-cc="' +
        cc.id +
        '"' +
        ' style="--cc-color:' +
        cc.color +
        '" data-action="toggleActive">' +
        '<span class="af-cc-dot" style="background:' +
        cc.color +
        '"></span>' +
        esc(cc.label) +
        '</button>';
    });
    html += '</div></div>';

    // Actions
    html +=
      '<div class="af-actions">' +
      '<button class="btn btn-ghost" data-action="hideNewForm">Cancel</button>' +
      '<button class="btn btn-primary" data-action="' +
      (isEdit ? 'saveEditAssess' : 'saveNewAssess') +
      '" data-aid="' +
      (isEdit ? assess.id : '') +
      '">' +
      (isEdit ? 'Save Changes' : 'Create Assessment') +
      '</button>' +
      '</div>';

    return html;
  }

  /* ── Assessment Form Helpers ────────────────────────────── */
  function autoSetDueDate() {
    var assigned = document.getElementById('af-date-assigned');
    if (!assigned || !assigned.value) return;
    var d = new Date(assigned.value + 'T12:00:00');
    d.setDate(d.getDate() + 7);
    var dueEl = document.getElementById('af-due');
    if (dueEl) dueEl.value = d.toISOString().slice(0, 10);
  }

  function setScoreMode(mode) {
    document.querySelectorAll('.af-scoremode-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    var el = document.getElementById('af-scoremode');
    if (el) el.value = mode;
    var wrap = document.getElementById('af-maxpoints-wrap');
    if (wrap) wrap.style.display = mode === 'points' ? '' : 'none';
  }

  /* ── Assessment CRUD ────────────────────────────────────── */
  function showNewForm() {
    _resetCollabState();
    _showingNewForm = true;
    _editingAssessId = null;
    var form = document.getElementById('new-assess-form');
    if (form) {
      form.style.display = 'block';
      form.innerHTML = renderAssessForm(activeCourse, null);
      form.scrollIntoView({ behavior: 'smooth' });
      renderCollabPanel();
    }
  }
  function hideNewForm() {
    _showingNewForm = false;
    _editingAssessId = null;
    var form = document.getElementById('new-assess-form');
    if (form) form.style.display = 'none';
  }

  function toggleSectionTags(secId) {
    var cbs = document.querySelectorAll('.af-tag-cb[data-section="' + secId + '"]');
    var allChecked = Array.from(cbs).every(function (cb) {
      return cb.checked;
    });
    cbs.forEach(function (cb) {
      cb.checked = !allChecked;
      cb.parentElement.classList.toggle('checked', !allChecked);
    });
    updateSectionBadge(secId);
  }
  function onTagChange(cb, secId) {
    cb.parentElement.classList.toggle('checked', cb.checked);
    var tc = document.querySelector('.af-tags-container');
    if (tc) tc.style.border = '';
    updateSectionBadge(secId);
  }
  function updateSectionBadge(secId) {
    var cbs = document.querySelectorAll('.af-tag-cb[data-section="' + secId + '"]');
    var count = Array.from(cbs).filter(function (cb) {
      return cb.checked;
    }).length;
    var group = cbs[0] ? cbs[0].closest('.af-section-group') : null;
    if (!group) return;
    var badge = group.querySelector('.af-section-badge');
    if (count > 0) {
      if (badge) {
        badge.textContent = count;
      } else {
        var header = group.querySelector('.af-section-header');
        var selectAll = header.querySelector('.af-select-all');
        var sec = getSections(activeCourse).find(function (s) {
          return s.id === secId;
        });
        var b = document.createElement('span');
        b.className = 'af-section-badge';
        b.style.background = sec ? sec.color : 'var(--text-3)';
        b.textContent = count;
        header.insertBefore(b, selectAll);
      }
    } else {
      if (badge) badge.remove();
    }
  }

  function saveNewAssess() {
    var titleEl = document.getElementById('af-title');
    var title = (titleEl ? titleEl.value : '').trim();
    if (!title) {
      if (titleEl) {
        titleEl.style.border = '2px solid var(--score-1)';
        titleEl.placeholder = 'Title is required';
        titleEl.focus();
      }
      return;
    }
    var dateAssigned =
      (document.getElementById('af-date-assigned') || {}).value || new Date().toISOString().slice(0, 10);
    var date = dateAssigned;
    var description = (document.getElementById('af-desc') ? document.getElementById('af-desc').value : '').trim();
    var tagIds = Array.from(document.querySelectorAll('.af-tag-cb:checked')).map(function (cb) {
      return cb.value;
    });
    if (tagIds.length === 0) {
      var tagsContainer = document.querySelector('.af-tags-container');
      if (tagsContainer) {
        tagsContainer.style.border = '2px solid var(--score-1)';
        tagsContainer.scrollIntoView({ behavior: 'smooth' });
      }
      return;
    }
    var evidence = (document.getElementById('af-evidence') || {}).value;
    var categoryId = (document.getElementById('af-category') || {}).value || '';
    var moduleId = (document.getElementById('af-module') || {}).value || '';
    var coreCompetencyIds = Array.from(document.querySelectorAll('.af-cc-chip.active')).map(function (el) {
      return el.dataset.cc;
    });
    var assessments = getAssessments(activeCourse);
    var id = uid();
    var rubricId = (document.getElementById('af-rubric') || {}).value || '';
    var dueDate = (document.getElementById('af-due') || {}).value || '';
    var newAssess = {
      id: id,
      title: title,
      date: date,
      dateAssigned: dateAssigned,
      type: 'summative',
      tagIds: tagIds,
      evidenceType: evidence,
      description: description,
      notes: '',
      created: new Date().toISOString(),
    };
    if (categoryId) {
      newAssess.categoryId = categoryId;
      newAssess.category_id = categoryId;
    }
    if (dueDate) newAssess.dueDate = dueDate;
    if (moduleId) newAssess.moduleId = moduleId;
    if (rubricId) newAssess.rubricId = rubricId;
    if (coreCompetencyIds.length > 0) newAssess.coreCompetencyIds = coreCompetencyIds;
    if (newCollaboration !== 'individual') newAssess.collaboration = newCollaboration;
    if (collabExcluded.size > 0) newAssess.excludedStudents = Array.from(collabExcluded);
    if (newCollaboration === 'pair' && collabPairs.length > 0) newAssess.pairs = collabPairs;
    if (newCollaboration === 'group' && collabGroups.length > 0) {
      newAssess.groups = collabGroups;
      newAssess.groupCount = collabGroupCount;
    }
    var scoreModeVal = (document.getElementById('af-scoremode') || {}).value || 'proficiency';
    if (scoreModeVal === 'points') {
      var mpEl = document.getElementById('af-maxpoints');
      var mp = parseInt(mpEl ? mpEl.value : 0, 10);
      if (!mp || mp <= 0 || isNaN(mp)) {
        if (mpEl) {
          mpEl.style.border = '2px solid var(--score-1)';
          mpEl.focus();
        }
        return;
      }
      newAssess.scoreMode = 'points';
      newAssess.maxPoints = mp;
    }
    var assessWeight = parseFloat((document.getElementById('af-weight') || {}).value) || 1;
    if (assessWeight !== 1) newAssess.weight = assessWeight;
    assessments.push(newAssess);
    saveAssessments(activeCourse, assessments);
    openAssessIds.clear();
    openAssessIds.add(id);
    _showingNewForm = false;
    _editingAssessId = null;
    render();
  }

  function editAssess(aid) {
    var cid = activeCourse;
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    if (!assess) return;
    AC.collaboration = assess.collaboration || 'individual';
    loadCollabData(assess);
    _showingNewForm = true;
    _editingAssessId = aid;
    var form = document.getElementById('new-assess-form');
    if (form) {
      form.style.display = 'block';
      form.innerHTML = renderAssessForm(cid, assess);
      form.scrollIntoView({ behavior: 'smooth' });
      renderCollabPanel();
    }
  }

  function saveEditAssess(aid) {
    var titleEl = document.getElementById('af-title');
    var title = (titleEl ? titleEl.value : '').trim();
    if (!title) {
      if (titleEl) {
        titleEl.style.border = '2px solid var(--score-1)';
        titleEl.placeholder = 'Title is required';
        titleEl.focus();
      }
      return;
    }
    var dateAssigned =
      (document.getElementById('af-date-assigned') || {}).value || new Date().toISOString().slice(0, 10);
    var date = dateAssigned;
    var description = (document.getElementById('af-desc') ? document.getElementById('af-desc').value : '').trim();
    var tagIds = Array.from(document.querySelectorAll('.af-tag-cb:checked')).map(function (cb) {
      return cb.value;
    });
    if (tagIds.length === 0) {
      var tc = document.querySelector('.af-tags-container');
      if (tc) {
        tc.style.border = '2px solid var(--score-1)';
        tc.scrollIntoView({ behavior: 'smooth' });
      }
      return;
    }
    var evidence = (document.getElementById('af-evidence') || {}).value;
    var categoryId = (document.getElementById('af-category') || {}).value || '';
    var assessments = getAssessments(activeCourse);
    var idx = assessments.findIndex(function (a) {
      return a.id === aid;
    });
    if (idx < 0) return;
    assessments[idx].title = title;
    assessments[idx].date = date;
    assessments[idx].dateAssigned = dateAssigned;
    assessments[idx].tagIds = tagIds;
    assessments[idx].evidenceType = evidence;
    assessments[idx].description = description;
    assessments[idx].categoryId = categoryId || undefined;
    assessments[idx].category_id = categoryId || undefined;
    assessments[idx].dueDate = (document.getElementById('af-due') || {}).value || undefined;
    assessments[idx].moduleId = (document.getElementById('af-module') || {}).value || undefined;
    assessments[idx].rubricId = (document.getElementById('af-rubric') || {}).value || undefined;
    var ccIds = Array.from(document.querySelectorAll('.af-cc-chip.active')).map(function (el) {
      return el.dataset.cc;
    });
    assessments[idx].coreCompetencyIds = ccIds.length > 0 ? ccIds : undefined;
    assessments[idx].collaboration = newCollaboration !== 'individual' ? newCollaboration : undefined;
    assessments[idx].excludedStudents = collabExcluded.size > 0 ? Array.from(collabExcluded) : undefined;
    assessments[idx].pairs = newCollaboration === 'pair' && collabPairs.length > 0 ? collabPairs : undefined;
    assessments[idx].groups = newCollaboration === 'group' && collabGroups.length > 0 ? collabGroups : undefined;
    assessments[idx].groupCount = newCollaboration === 'group' ? collabGroupCount : undefined;
    assessments[idx].successCriteria = undefined;
    var scoreModeVal = (document.getElementById('af-scoremode') || {}).value || 'proficiency';
    if (scoreModeVal === 'points') {
      var mpEl = document.getElementById('af-maxpoints');
      var mp = parseInt(mpEl ? mpEl.value : 0, 10);
      if (!mp || mp <= 0 || isNaN(mp)) {
        if (mpEl) {
          mpEl.style.border = '2px solid var(--score-1)';
          mpEl.focus();
        }
        return;
      }
      assessments[idx].scoreMode = 'points';
      assessments[idx].maxPoints = mp;
    } else {
      assessments[idx].scoreMode = undefined;
      assessments[idx].maxPoints = undefined;
    }
    var assessWeight = parseFloat((document.getElementById('af-weight') || {}).value) || 1;
    assessments[idx].weight = assessWeight !== 1 ? assessWeight : undefined;
    saveAssessments(activeCourse, assessments);
    openAssessIds.add(aid);
    hideNewForm();
    render();
  }

  function dupeAssess(aid) {
    var cid = activeCourse;
    var assessments = getAssessments(cid);
    var orig = assessments.find(function (a) {
      return a.id === aid;
    });
    if (!orig) return;
    var id = uid();
    var dupe = structuredClone(orig);
    dupe.id = id;
    dupe.title = orig.title + ' (Copy)';
    dupe.created = new Date().toISOString();
    assessments.push(dupe);
    saveAssessments(cid, assessments);
    openAssessIds.add(id);
    render();
  }

  function deleteAssess(aid) {
    showConfirm('Delete Assessment', 'Delete this assessment and all its scores?', 'Delete', 'danger', function () {
      var cid = activeCourse;
      saveAssessments(
        cid,
        getAssessments(cid).filter(function (a) {
          return a.id !== aid;
        }),
      );
      var scores = getScores(cid);
      Object.keys(scores).forEach(function (sid) {
        scores[sid] = (scores[sid] || []).filter(function (s) {
          return s.assessmentId !== aid;
        });
      });
      saveScores(cid, scores);
      var statuses = getAssignmentStatuses(cid);
      var statusChanged = false;
      Object.keys(statuses).forEach(function (k) {
        if (k.endsWith(':' + aid)) {
          delete statuses[k];
          statusChanged = true;
        }
      });
      if (statusChanged) saveAssignmentStatuses(cid, statuses);
      var obs = getQuickObs(cid);
      var obsChanged = false;
      Object.keys(obs).forEach(function (sid) {
        var before = obs[sid].length;
        obs[sid] = obs[sid].filter(function (o) {
          return !(o.assignmentContext && o.assignmentContext.assessmentId === aid);
        });
        if (obs[sid].length !== before) obsChanged = true;
      });
      if (obsChanged) saveQuickObs(cid, obs);
      openAssessIds.delete(aid);
      _collapsedIds.delete(aid);
      render();
      refreshSidebar();
    });
  }

  /* ── Expand/Collapse ────────────────────────────────────── */
  function toggleAssess(aid) {
    if (focusStudentId) {
      if (_allExpanded) {
        if (_collapsedIds.has(aid)) _collapsedIds.delete(aid);
        else _collapsedIds.add(aid);
      } else {
        if (openAssessIds.has(aid)) openAssessIds.delete(aid);
        else openAssessIds.add(aid);
      }
    } else {
      if (openAssessIds.has(aid)) openAssessIds.delete(aid);
      else openAssessIds.add(aid);
    }
    render();
  }
  function expandAllAssess() {
    _allExpanded = true;
    _collapsedIds.clear();
    openAssessIds.clear();
    if (!focusStudentId)
      getAssessments(activeCourse).forEach(function (a) {
        openAssessIds.add(a.id);
      });
    render();
  }
  function collapseAllAssess() {
    _allExpanded = false;
    _collapsedIds.clear();
    openAssessIds.clear();
    render();
  }

  /* ── Rubric view toggle ─────────────────────────────────── */
  function setRubricView(aid, isRubric) {
    rubricViewStates[aid] = isRubric;
    render();
    if (isRubric) showDescriptorBar();
    else hideDescriptorBar();
  }

  function toggleToolbarDropdown(which) {
    _advancedPanelOpen = !_advancedPanelOpen;
    _rubricsPanelOpen = false;
    var ap = document.getElementById('tb-advanced-panel');
    var rp = document.getElementById('tb-rubrics-panel');
    if (ap) ap.classList.toggle('open', _advancedPanelOpen);
    if (rp) rp.classList.remove('open');
    document.querySelectorAll('.tb-dropdown-btn').forEach(function (btn) {
      btn.classList.toggle('open', _advancedPanelOpen);
    });
  }

  /* ── Scoring Functions ──────────────────────────────────── */
  function renderPointsGrid(cid, a, students, scores) {
    var max = a.maxPoints || 100;
    var statuses = getAssignmentStatuses(cid);
    var html =
      '<div class="score-grid pts-grid">' +
      '<div class="score-grid-header">' +
      '<div class="score-grid-header-name">Student</div>' +
      '<div class="score-col-header" style="text-align:center"><span class="score-col-header-id">Score</span><span class="score-col-header-name">out of ' +
      max +
      '</span></div>' +
      '<div class="score-col-header" style="text-align:center"><span class="score-col-header-id">%</span></div>' +
      '<div class="score-row-action"></div>' +
      '</div>';
    students.forEach(function (st) {
      var raw = getPointsScore(cid, st.id, a.id);
      var pct = raw > 0 ? Math.round((raw / max) * 100) : '';
      var stStatus = statuses[st.id + ':' + a.id] || null;
      var disableRow = stStatus && stStatus !== 'late';
      html +=
        '<div class="score-row' +
        (disableRow ? ' has-status' : '') +
        (stStatus === 'late' ? ' has-late' : '') +
        '" data-status-student="' +
        st.id +
        '" data-status-assess="' +
        a.id +
        '">' +
        '<span class="score-name">' +
        esc(displayName(st)) +
        renderStatusToggles(a.id, st.id, stStatus) +
        '</span>' +
        '<div class="pts-input-cell">' +
        '<input type="number" class="gb-pts-input" min="0" max="' +
        max +
        '" inputmode="numeric"' +
        ' value="' +
        (raw > 0 ? raw : '') +
        '" data-sid="' +
        st.id +
        '" data-aid="' +
        a.id +
        '" data-max="' +
        max +
        '"' +
        (disableRow ? ' disabled' : '') +
        '>' +
        '<span class="gb-pts-max">/' +
        max +
        '</span>' +
        '</div>' +
        '<div class="pts-pct-cell">' +
        '<span class="gb-pts-live-pct">' +
        (pct ? pct + '%' : '') +
        '</span>' +
        '</div>' +
        '<div class="score-row-action"></div>' +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  function livePointsUpdate(inp) {
    var v = parseInt(inp.value, 10);
    var max = parseInt(inp.dataset.max, 10) || 100;
    var pctSpan = inp.closest('.score-row').querySelector('.gb-pts-live-pct');
    if (pctSpan) pctSpan.textContent = !isNaN(v) && v >= 0 ? Math.round((Math.min(v, max) / max) * 100) + '%' : '';
  }
  function commitPointsScore(inp) {
    var cid = activeCourse;
    var sid = inp.dataset.sid;
    var aid = inp.dataset.aid;
    var max = parseInt(inp.dataset.max, 10) || 100;
    var val = parseInt(inp.value, 10);
    var raw = isNaN(val) ? 0 : Math.max(0, Math.min(max, val));
    inp.value = raw > 0 ? raw : '';
    setScore(cid, sid, aid, aid, raw);
    setPointsScore(cid, sid, aid, raw);
    var pctSpan = inp.closest('.score-row').querySelector('.gb-pts-live-pct');
    if (pctSpan) pctSpan.textContent = raw > 0 ? Math.round((raw / max) * 100) + '%' : '';
  }
  function handlePointsKey(e, inp) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitPointsScore(inp);
      var row = inp.closest('.score-row');
      var next = row.nextElementSibling;
      if (next) {
        var ni = next.querySelector('.gb-pts-input');
        if (ni) {
          ni.focus();
          ni.select();
        }
      }
    } else if (e.key === 'Escape') {
      var raw = getPointsScore(activeCourse, inp.dataset.sid, inp.dataset.aid);
      inp.value = raw > 0 ? raw : '';
      inp.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      var next = inp.closest('.score-row').nextElementSibling;
      if (next) {
        var ni = next.querySelector('.gb-pts-input');
        if (ni) {
          ni.focus();
          ni.select();
        }
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      var prev = inp.closest('.score-row').previousElementSibling;
      if (prev) {
        var pi = prev.querySelector('.gb-pts-input');
        if (pi) {
          pi.focus();
          pi.select();
        }
      }
    }
  }

  function renderStatusToggles(aid, sid, currentStatus) {
    var cid = activeCourse;
    var commentCount = getAssignmentObs(cid, sid, aid).length;
    return (
      '<div class="student-status-toggles">' +
      '<button class="student-status-btn' +
      (currentStatus === 'excused' ? ' active-excused' : '') +
      '" tabindex="-1" data-action="toggleStudentStatus" data-aid="' +
      aid +
      '" data-sid="' +
      sid +
      '" data-status="excused" data-stop-prop="true" title="Excused">EXC</button>' +
      '<button class="student-status-btn' +
      (currentStatus === 'notSubmitted' ? ' active-ns' : '') +
      '" tabindex="-1" data-action="toggleStudentStatus" data-aid="' +
      aid +
      '" data-sid="' +
      sid +
      '" data-status="notSubmitted" data-stop-prop="true" title="Not Submitted">NS</button>' +
      '<button class="comment-btn" data-action="openCommentPopover" data-cid="' +
      cid +
      '" data-sid="' +
      sid +
      '" data-aid="' +
      aid +
      '" data-stop-prop="true" title="Comments">Comment' +
      (commentCount > 0 ? ' <span class="comment-count">' + commentCount + '</span>' : '') +
      '</button>' +
      '</div>' +
      '<div class="student-status-toggles student-status-row2">' +
      '<button class="student-status-btn student-status-late' +
      (currentStatus === 'late' ? ' active-late' : '') +
      '" tabindex="-1" data-action="toggleStudentStatus" data-aid="' +
      aid +
      '" data-sid="' +
      sid +
      '" data-status="late" data-stop-prop="true" title="Late">LATE</button>' +
      '</div>'
    );
  }

  function toggleStudentStatus(aid, sid, status) {
    var debounceKey = sid + ':' + aid + ':' + status;
    if (_statusDebounce[debounceKey]) return;
    _statusDebounce[debounceKey] = true;
    setTimeout(function () {
      delete _statusDebounce[debounceKey];
    }, 300);
    var cid = activeCourse;
    var current = getAssignmentStatus(cid, sid, aid);
    var newStatus = current === status ? null : status;
    setAssignmentStatus(cid, sid, aid, newStatus);
    if (newStatus === 'notSubmitted') {
      var assess = getAssessments(cid).find(function (a) {
        return a.id === aid;
      });
      if (assess) {
        (assess.tagIds || []).forEach(function (tagId) {
          upsertScore(cid, sid, aid, tagId, 0, assess.date || '', assess.type || 'summative', '');
        });
      }
    }
    var row =
      document.querySelector('.score-row[data-status-student="' + sid + '"][data-status-assess="' + aid + '"]') ||
      document.querySelector('.rsg-student[data-status-student="' + sid + '"][data-status-assess="' + aid + '"]');
    if (row) {
      row.querySelectorAll('.student-status-btn').forEach(function (btn) {
        btn.classList.remove('active-excused', 'active-ns', 'active-late');
      });
      if (newStatus === 'excused') row.querySelector('[data-status="excused"]').classList.add('active-excused');
      else if (newStatus === 'notSubmitted')
        row.querySelector('[data-status="notSubmitted"]').classList.add('active-ns');
      else if (newStatus === 'late') row.querySelector('[data-status="late"]').classList.add('active-late');
      // Late doesn't disable scoring — student submitted, just late
      var disableScoring = newStatus && newStatus !== 'late';
      if (disableScoring) row.classList.add('has-status');
      else row.classList.remove('has-status');
      if (newStatus === 'late') row.classList.add('has-late');
      else row.classList.remove('has-late');
      var ptsInput = row.querySelector('.gb-pts-input');
      if (ptsInput) ptsInput.disabled = disableScoring;
      if (newStatus === 'notSubmitted') {
        row.querySelectorAll('.score-opt, .rsg-level').forEach(function (el) {
          el.classList.remove('active', 'mixed');
        });
        if (ptsInput) {
          ptsInput.value = '';
          var ps = row.querySelector('.gb-pts-live-pct');
          if (ps) ps.textContent = '';
        }
      }
    }
    refreshSidebar();
  }

  function setScore(cid, sid, aid, tagId, value) {
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    upsertScore(cid, sid, aid, tagId, value, assess ? assess.date : '', assess ? assess.type : 'summative', '');
  }

  function updateGroupUI(group, value) {
    group.querySelectorAll('.score-opt').forEach(function (o) {
      o.classList.remove('active');
    });
    if (value > 0) {
      var opt = group.querySelector('.s' + value);
      if (opt) opt.classList.add('active');
    }
  }

  function selectTagLevel(el, value, aid, sid, tagId) {
    var wasActive = el.classList.contains('active');
    var next = wasActive ? 0 : value;
    setScore(activeCourse, sid, aid, tagId, next);
    el.parentElement.querySelectorAll('.rsg-level').forEach(function (o) {
      o.classList.remove('active');
    });
    if (!wasActive) el.classList.add('active');
    refreshSidebar();
  }

  function selectScore(el, value) {
    var group = el.parentElement;
    var cid = activeCourse;
    var sid = group.dataset.student;
    var aid = group.dataset.assess;
    var tagId = group.dataset.tag;
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var wasActive = el.classList.contains('active');
    var next = wasActive ? 0 : value;
    upsertScore(cid, sid, aid, tagId, next, assess ? assess.date : '', assess ? assess.type : 'summative', '');
    group.querySelectorAll('.score-opt').forEach(function (o) {
      o.classList.remove('active');
    });
    if (!wasActive) el.classList.add('active');
    refreshSidebar();
  }

  /* ── Bulk scoring ───────────────────────────────────────── */
  function closeMenus() {
    document.querySelectorAll('.col-fill-menu').forEach(function (m) {
      m.classList.remove('open');
    });
  }
  function positionMenu(trigger, menu) {
    var rect = trigger.getBoundingClientRect();
    var menuH = 180;
    var spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < menuH) {
      menu.style.bottom = window.innerHeight - rect.top + 4 + 'px';
      menu.style.top = 'auto';
    } else {
      menu.style.top = rect.bottom + 4 + 'px';
      menu.style.bottom = 'auto';
    }
    var menuW = 150;
    var left = rect.left + rect.width / 2 - menuW / 2;
    if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
    if (left < 8) left = 8;
    menu.style.left = left + 'px';
  }
  function toggleScoreMenu(trigger) {
    var menu = trigger.querySelector('.col-fill-menu');
    var wasOpen = menu.classList.contains('open');
    closeMenus();
    if (!wasOpen) {
      positionMenu(trigger, menu);
      menu.classList.add('open');
    }
  }
  function fillScores(aid, tagId, value, scope) {
    var cid = activeCourse;
    var prevScores = structuredClone(getScores(cid));
    var students = getStudents(cid);
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var statuses = getAssignmentStatuses(cid);
    var selector, toastMsg;
    if (scope === 'col') {
      students.forEach(function (st) {
        if (statuses[st.id + ':' + aid]) return;
        setScore(cid, st.id, aid, tagId, value);
      });
      selector = '.score-group[data-assess="' + aid + '"][data-tag="' + tagId + '"]';
      toastMsg = 'Column filled';
    } else if (scope === 'row') {
      if (!assess) return;
      var sid = tagId;
      if (!statuses[sid + ':' + aid])
        (assess.tagIds || []).forEach(function (tid) {
          setScore(cid, sid, aid, tid, value);
        });
      selector = '.score-group[data-assess="' + aid + '"][data-student="' + sid + '"]';
      toastMsg = 'Row filled';
    } else {
      if (!assess) return;
      students.forEach(function (st) {
        if (statuses[st.id + ':' + aid]) return;
        (assess.tagIds || []).forEach(function (tid) {
          setScore(cid, st.id, aid, tid, value);
        });
      });
      selector = '.score-group[data-assess="' + aid + '"]';
      toastMsg = 'All scores filled';
    }
    document.querySelectorAll(selector).forEach(function (g) {
      updateGroupUI(g, value);
    });
    refreshSidebar();
    showUndoToast(toastMsg, function () {
      saveScores(cid, prevScores);
      render();
      refreshSidebar();
    });
  }

  /* ── Rubric Grading ─────────────────────────────────────── */
  function getRubricCriterion(aid, critId) {
    var assess = getAssessments(activeCourse).find(function (a) {
      return a.id === aid;
    });
    if (!assess || !assess.rubricId) return null;
    var rubric = getRubricById(activeCourse, assess.rubricId);
    if (!rubric) return null;
    return rubric.criteria.find(function (c) {
      return c.id === critId;
    });
  }
  function selectRubricScore(el, value, aid, sid, critId) {
    var crit = getRubricCriterion(aid, critId);
    if (!crit) return;
    var wasActive = el.classList.contains('active');
    var next = wasActive ? 0 : value;
    (crit.tagIds || []).forEach(function (tagId) {
      setScore(activeCourse, sid, aid, tagId, next);
    });
    el.parentElement.querySelectorAll('.rsg-level').forEach(function (o) {
      o.classList.remove('active', 'mixed');
    });
    if (!wasActive) el.classList.add('active');
    refreshSidebar();
  }
  function updateRubricRowUI(row, value) {
    row.querySelectorAll('.rsg-level').forEach(function (l) {
      l.classList.remove('active', 'mixed');
    });
    if (value > 0) {
      var lvl = row.querySelector('.l' + value);
      if (lvl) lvl.classList.add('active');
    }
  }
  function fillRubricScores(aid, critId, value, scope) {
    var cid = activeCourse;
    var prevScores = structuredClone(getScores(cid));
    var students = getStudents(cid);
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var statuses = getAssignmentStatuses(cid);
    var selector, toastMsg;
    if (scope === 'col') {
      var crit = getRubricCriterion(aid, critId);
      if (!crit) return;
      students.forEach(function (st) {
        if (statuses[st.id + ':' + aid]) return;
        (crit.tagIds || []).forEach(function (tagId) {
          setScore(cid, st.id, aid, tagId, value);
        });
      });
      selector = '.rsg-criterion-row[data-assess="' + aid + '"][data-criterion="' + critId + '"]';
      toastMsg = 'Criterion filled';
    } else if (scope === 'row') {
      if (!assess || !assess.rubricId) return;
      var rubric = getRubricById(cid, assess.rubricId);
      if (!rubric) return;
      var sid = critId;
      if (!statuses[sid + ':' + aid])
        rubric.criteria.forEach(function (crit) {
          (crit.tagIds || []).forEach(function (tagId) {
            setScore(cid, sid, aid, tagId, value);
          });
        });
      selector = '.rsg-criterion-row[data-assess="' + aid + '"][data-student="' + sid + '"]';
      toastMsg = 'Row filled';
    } else {
      if (!assess || !assess.rubricId) return;
      var rubric = getRubricById(cid, assess.rubricId);
      if (!rubric) return;
      students.forEach(function (st) {
        if (statuses[st.id + ':' + aid]) return;
        rubric.criteria.forEach(function (crit) {
          (crit.tagIds || []).forEach(function (tagId) {
            setScore(cid, st.id, aid, tagId, value);
          });
        });
      });
      selector = '.rsg-criterion-row[data-assess="' + aid + '"]';
      toastMsg = 'All rubric scores filled';
    }
    document.querySelectorAll(selector).forEach(function (row) {
      updateRubricRowUI(row, value);
    });
    refreshSidebar();
    showUndoToast(toastMsg, function () {
      saveScores(cid, prevScores);
      render();
      refreshSidebar();
    });
  }
  function confirmFillAll(aid, value, label) {
    showConfirm('Fill All Scores', 'Set all students to "' + label + '"?', 'Fill All', 'primary', function () {
      fillScores(aid, null, value, 'all');
    });
  }
  function confirmFillRubricAll(aid, value, label) {
    showConfirm(
      'Fill All Scores',
      'Set all students to "' + label + '" for every criterion?',
      'Fill All',
      'primary',
      function () {
        fillRubricScores(aid, null, value, 'all');
      },
    );
  }

  function renderTagGrid(cid, a, tagObjs, students, scores) {
    var html = '<div class="rsg-grid">';
    html +=
      '<div class="rsg-header"><div class="rsg-header-spacer">Student</div><div class="rsg-header-inner"><div class="rsg-header-crit-spacer"></div><div class="rsg-header-levels">' +
      '<div class="rsg-header-level hl4" data-action="confirmFillAll" data-aid="' +
      a.id +
      '" data-score="4" data-label="Extending" title="Fill all Extending">Extending</div>' +
      '<div class="rsg-header-level hl3" data-action="confirmFillAll" data-aid="' +
      a.id +
      '" data-score="3" data-label="Proficient" title="Fill all Proficient">Proficient</div>' +
      '<div class="rsg-header-level hl2" data-action="confirmFillAll" data-aid="' +
      a.id +
      '" data-score="2" data-label="Developing" title="Fill all Developing">Developing</div>' +
      '<div class="rsg-header-level hl1" data-action="confirmFillAll" data-aid="' +
      a.id +
      '" data-score="1" data-label="Emerging" title="Fill all Emerging">Emerging</div>' +
      '</div></div><div class="rsg-header-action"></div></div>';
    var statuses = getAssignmentStatuses(cid);
    students.forEach(function (st) {
      var studentScores = scores[st.id] || [];
      var stStatus = statuses[st.id + ':' + a.id] || null;
      var disableRow = stStatus && stStatus !== 'late';
      html +=
        '<div class="rsg-student' +
        (disableRow ? ' has-status' : '') +
        (stStatus === 'late' ? ' has-late' : '') +
        '" data-status-student="' +
        st.id +
        '" data-status-assess="' +
        a.id +
        '">' +
        '<div class="rsg-student-name">' +
        esc(displayName(st)) +
        renderStatusToggles(a.id, st.id, stStatus) +
        '</div><div class="rsg-criteria">';
      tagObjs.forEach(function (tag) {
        var entry = studentScores.find(function (s) {
          return s.assessmentId === a.id && s.tagId === tag.id;
        });
        var score = entry ? entry.score : 0;
        html +=
          '<div class="rsg-criterion-row is-tag" data-student="' +
          st.id +
          '" data-assess="' +
          a.id +
          '" data-tag="' +
          tag.id +
          '">' +
          '<div class="rsg-criterion-label" title="' +
          esc(tag.text || tag.label) +
          '"><svg class="rsg-tag-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 9.5V2.5a1 1 0 0 1 1-1h7l5 5v3"/><path d="M14.5 9.5l-5 5-4-4 5-5"/><circle cx="5" cy="5" r="1" fill="currentColor" stroke="none"/></svg>' +
          esc(tag.label) +
          '</div>' +
          '<div class="rsg-levels">' +
          '<div class="rsg-level l4' +
          (score === 4 ? ' active' : '') +
          '" data-action="selectTagLevel" data-level="4" data-aid="' +
          a.id +
          '" data-sid="' +
          st.id +
          '" data-tagid="' +
          tag.id +
          '" role="button" tabindex="0">Extending</div>' +
          '<div class="rsg-level l3' +
          (score === 3 ? ' active' : '') +
          '" data-action="selectTagLevel" data-level="3" data-aid="' +
          a.id +
          '" data-sid="' +
          st.id +
          '" data-tagid="' +
          tag.id +
          '" role="button" tabindex="0">Proficient</div>' +
          '<div class="rsg-level l2' +
          (score === 2 ? ' active' : '') +
          '" data-action="selectTagLevel" data-level="2" data-aid="' +
          a.id +
          '" data-sid="' +
          st.id +
          '" data-tagid="' +
          tag.id +
          '" role="button" tabindex="0">Developing</div>' +
          '<div class="rsg-level l1' +
          (score === 1 ? ' active' : '') +
          '" data-action="selectTagLevel" data-level="1" data-aid="' +
          a.id +
          '" data-sid="' +
          st.id +
          '" data-tagid="' +
          tag.id +
          '" role="button" tabindex="0">Emerging</div>' +
          '</div></div>';
      });
      html +=
        '</div><div class="score-row-action"><div class="row-fill-btn" data-action="toggleScoreMenu" title="Fill row">\u25BC<div class="col-fill-menu" data-stop-prop="true">' +
        '<div class="col-fill-option" data-action="fillScoresAndClose" data-aid="' +
        a.id +
        '" data-sid="' +
        st.id +
        '" data-score="4" data-scope="row"><div class="col-fill-dot" style="background:var(--score-4)">4</div> Extending</div>' +
        '<div class="col-fill-option" data-action="fillScoresAndClose" data-aid="' +
        a.id +
        '" data-sid="' +
        st.id +
        '" data-score="3" data-scope="row"><div class="col-fill-dot" style="background:var(--score-3)">3</div> Proficient</div>' +
        '<div class="col-fill-option" data-action="fillScoresAndClose" data-aid="' +
        a.id +
        '" data-sid="' +
        st.id +
        '" data-score="2" data-scope="row"><div class="col-fill-dot" style="background:var(--score-2)">2</div> Developing</div>' +
        '<div class="col-fill-option" data-action="fillScoresAndClose" data-aid="' +
        a.id +
        '" data-sid="' +
        st.id +
        '" data-score="1" data-scope="row"><div class="col-fill-dot" style="background:var(--score-1)">1</div> Emerging</div>' +
        '<div class="col-fill-option" data-action="fillScoresAndClose" data-aid="' +
        a.id +
        '" data-sid="' +
        st.id +
        '" data-score="0" data-scope="row"><div class="col-fill-dot" style="background:var(--surface-2);color:var(--text-3)">0</div> Clear</div>' +
        '</div></div></div></div>';
    });
    html += '</div>';
    return html;
  }

  function renderRubricGradingView(cid, a, students, scores) {
    var rubric = getRubricById(cid, a.rubricId);
    if (!rubric) return '';
    var criteria = rubric.criteria || [];
    var rubricTagIds = new Set();
    criteria.forEach(function (c) {
      (c.tagIds || []).forEach(function (t) {
        rubricTagIds.add(t);
      });
    });
    var extraTagIds = (a.tagIds || []).filter(function (tid) {
      return !rubricTagIds.has(tid);
    });
    var extraTagObjs = extraTagIds
      .map(function (tid) {
        return getTagById(cid, tid);
      })
      .filter(Boolean);

    var html = '<div class="rsg-grid">';
    html +=
      '<div class="rsg-header"><div class="rsg-header-spacer">Student</div><div class="rsg-header-inner"><div class="rsg-header-crit-spacer"></div><div class="rsg-header-levels">' +
      '<div class="rsg-header-level hl4" data-action="confirmFillRubricAll" data-aid="' +
      a.id +
      '" data-score="4" data-label="Extending" title="Fill all Extending">Extending</div>' +
      '<div class="rsg-header-level hl3" data-action="confirmFillRubricAll" data-aid="' +
      a.id +
      '" data-score="3" data-label="Proficient" title="Fill all Proficient">Proficient</div>' +
      '<div class="rsg-header-level hl2" data-action="confirmFillRubricAll" data-aid="' +
      a.id +
      '" data-score="2" data-label="Developing" title="Fill all Developing">Developing</div>' +
      '<div class="rsg-header-level hl1" data-action="confirmFillRubricAll" data-aid="' +
      a.id +
      '" data-score="1" data-label="Emerging" title="Fill all Emerging">Emerging</div>' +
      '</div></div><div class="rsg-header-action"></div></div>';

    var statuses = getAssignmentStatuses(cid);
    students.forEach(function (st) {
      var studentScores = scores[st.id] || [];
      var stStatus = statuses[st.id + ':' + a.id] || null;
      var disableRow = stStatus && stStatus !== 'late';
      html +=
        '<div class="rsg-student' +
        (disableRow ? ' has-status' : '') +
        (stStatus === 'late' ? ' has-late' : '') +
        '" data-status-student="' +
        st.id +
        '" data-status-assess="' +
        a.id +
        '">' +
        '<div class="rsg-student-name">' +
        esc(displayName(st)) +
        renderStatusToggles(a.id, st.id, stStatus) +
        '</div><div class="rsg-criteria">';
      criteria.forEach(function (crit) {
        var tagScores = (crit.tagIds || []).map(function (tid) {
          var entry = studentScores.find(function (s) {
            return s.assessmentId === a.id && s.tagId === tid;
          });
          return entry ? entry.score : 0;
        });
        var nonZero = tagScores.filter(function (s) {
          return s > 0;
        });
        var allSame =
          nonZero.length > 0 &&
          nonZero.every(function (s) {
            return s === nonZero[0];
          });
        var displayScore = nonZero.length === 0 ? 0 : allSame ? nonZero[0] : Math.min.apply(null, nonZero);
        var isMixed = nonZero.length > 0 && !allSame;
        html +=
          '<div class="rsg-criterion-row" data-student="' +
          st.id +
          '" data-assess="' +
          a.id +
          '" data-criterion="' +
          crit.id +
          '">' +
          '<div class="rsg-criterion-label" title="' +
          esc(crit.name) +
          '">' +
          esc(crit.name) +
          '</div><div class="rsg-levels">' +
          '<div class="rsg-level l4' +
          (displayScore === 4 ? (isMixed ? ' active mixed' : ' active') : '') +
          '" data-action="selectRubricScore" data-level="4" data-aid="' +
          a.id +
          '" data-sid="' +
          st.id +
          '" data-critid="' +
          crit.id +
          '" role="button" tabindex="0">Extending</div>' +
          '<div class="rsg-level l3' +
          (displayScore === 3 ? (isMixed ? ' active mixed' : ' active') : '') +
          '" data-action="selectRubricScore" data-level="3" data-aid="' +
          a.id +
          '" data-sid="' +
          st.id +
          '" data-critid="' +
          crit.id +
          '" role="button" tabindex="0">Proficient</div>' +
          '<div class="rsg-level l2' +
          (displayScore === 2 ? (isMixed ? ' active mixed' : ' active') : '') +
          '" data-action="selectRubricScore" data-level="2" data-aid="' +
          a.id +
          '" data-sid="' +
          st.id +
          '" data-critid="' +
          crit.id +
          '" role="button" tabindex="0">Developing</div>' +
          '<div class="rsg-level l1' +
          (displayScore === 1 ? (isMixed ? ' active mixed' : ' active') : '') +
          '" data-action="selectRubricScore" data-level="1" data-aid="' +
          a.id +
          '" data-sid="' +
          st.id +
          '" data-critid="' +
          crit.id +
          '" role="button" tabindex="0">Emerging</div>' +
          '</div></div>';
      });
      html +=
        '</div><div class="score-row-action"><div class="row-fill-btn" data-action="toggleScoreMenu" title="Fill row">\u25BC<div class="col-fill-menu" data-stop-prop="true">' +
        '<div class="col-fill-option" data-action="fillRubricScoresAndClose" data-aid="' +
        a.id +
        '" data-sid="' +
        st.id +
        '" data-score="4" data-scope="row"><div class="col-fill-dot" style="background:var(--score-4)">4</div> Extending</div>' +
        '<div class="col-fill-option" data-action="fillRubricScoresAndClose" data-aid="' +
        a.id +
        '" data-sid="' +
        st.id +
        '" data-score="3" data-scope="row"><div class="col-fill-dot" style="background:var(--score-3)">3</div> Proficient</div>' +
        '<div class="col-fill-option" data-action="fillRubricScoresAndClose" data-aid="' +
        a.id +
        '" data-sid="' +
        st.id +
        '" data-score="2" data-scope="row"><div class="col-fill-dot" style="background:var(--score-2)">2</div> Developing</div>' +
        '<div class="col-fill-option" data-action="fillRubricScoresAndClose" data-aid="' +
        a.id +
        '" data-sid="' +
        st.id +
        '" data-score="1" data-scope="row"><div class="col-fill-dot" style="background:var(--score-1)">1</div> Emerging</div>' +
        '<div class="col-fill-option" data-action="fillRubricScoresAndClose" data-aid="' +
        a.id +
        '" data-sid="' +
        st.id +
        '" data-score="0" data-scope="row"><div class="col-fill-dot" style="background:var(--surface-2);color:var(--text-3)">0</div> Clear</div>' +
        '</div></div></div></div>';
    });
    html += '</div>';

    if (extraTagObjs.length > 0) {
      html +=
        '<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">' +
        "<div style=\"font-family:'SF Mono', ui-monospace, 'Menlo', monospace;font-size:0.6rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-3);font-weight:600;margin-bottom:6px\">Additional Tags (not in rubric)</div>";
      html += renderTagGrid(cid, a, extraTagObjs, students, scores);
      html += '</div>';
    }
    return html;
  }

  /* ── Descriptor bar ─────────────────────────────────────── */
  function _ensureDescriptorBar() {
    var bar = document.getElementById('rsg-descriptor-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'rsg-descriptor-bar';
      bar.id = 'rsg-descriptor-bar';
      bar.innerHTML =
        '<div class="rsg-descriptor-left"><span class="rsg-descriptor-label"></span><span class="rsg-descriptor-tags"></span></div><span class="rsg-descriptor-text"></span>';
      document.body.appendChild(bar);
      _resetDescriptorBarContent(bar);
    }
    return bar;
  }
  function _resetDescriptorBarContent(bar) {
    bar.querySelector('.rsg-descriptor-label').innerHTML = '';
    bar.querySelector('.rsg-descriptor-tags').innerHTML = '';
    bar.querySelector('.rsg-descriptor-text').innerHTML =
      '<span class="rsg-descriptor-idle">Hover a rubric level to see its descriptor</span>';
  }
  function showDescriptorBar() {
    var bar = _ensureDescriptorBar();
    bar.style.display = 'flex';
  }
  function hideDescriptorBar() {
    var bar = document.getElementById('rsg-descriptor-bar');
    if (bar) bar.style.display = 'none';
  }
  function resetDescriptorBar() {
    var bar = document.getElementById('rsg-descriptor-bar');
    if (bar) _resetDescriptorBarContent(bar);
  }
  function showCritTooltip(event, aid, critId, level) {
    var crit = getRubricCriterion(aid, critId);
    if (!crit || !crit.levels || !crit.levels[level]) return;
    var levelNames = { 4: 'Extending', 3: 'Proficient', 2: 'Developing', 1: 'Emerging' };
    var levelColors = { 4: 'var(--score-4)', 3: 'var(--score-3)', 2: 'var(--score-2)', 1: 'var(--score-1)' };
    var bar = _ensureDescriptorBar();
    bar.querySelector('.rsg-descriptor-label').innerHTML =
      esc(crit.name) +
      ' <span style="color:' +
      (levelColors[level] || 'var(--text-3)') +
      '">\u2014 ' +
      (levelNames[level] || level) +
      '</span>';
    var tagsHtml = (crit.tagIds || [])
      .map(function (tid) {
        var tag = getTagById(activeCourse, tid);
        var sec = getSectionForTag(activeCourse, tid);
        var color = sec ? sec.color : 'var(--text-3)';
        return (
          '<span class="rsg-descriptor-tag" style="border-color:' +
          color +
          ';color:' +
          color +
          '">' +
          esc(tid) +
          (tag ? ' \u00B7 ' + esc(tag.label) : '') +
          '</span>'
        );
      })
      .join('');
    bar.querySelector('.rsg-descriptor-tags').innerHTML = tagsHtml;
    bar.querySelector('.rsg-descriptor-text').textContent = crit.levels[level];
  }

  /* ── Rubric Select in Assessment Form ───────────────────── */
  function onRubricSelect(rubricId) {
    if (!rubricId) return;
    var rubric = getRubricById(activeCourse, rubricId);
    if (!rubric) return;
    _rubricAutoTags.forEach(function (tagId) {
      var cb = document.querySelector('.af-tag-cb[value="' + tagId + '"]');
      if (cb && cb.checked) {
        cb.checked = false;
        cb.parentElement.classList.remove('checked');
        var secId = cb.dataset.section;
        if (secId) updateSectionBadge(secId);
      }
    });
    _rubricAutoTags = [];
    var rubricTagIds = new Set();
    rubric.criteria.forEach(function (c) {
      (c.tagIds || []).forEach(function (t) {
        rubricTagIds.add(t);
      });
    });
    document.querySelectorAll('.af-tag-cb').forEach(function (cb) {
      if (rubricTagIds.has(cb.value) && !cb.checked) {
        cb.checked = true;
        cb.parentElement.classList.add('checked');
        _rubricAutoTags.push(cb.value);
        var secId = cb.dataset.section;
        if (secId) updateSectionBadge(secId);
        var group = cb.closest('.af-section-group');
        if (group && !group.classList.contains('af-section-open')) group.classList.add('af-section-open');
      }
    });
  }

  /* ── Rubric Builder UI ──────────────────────────────────── */
  function newRubricUI() {
    _editingRubric = {
      id: uid(),
      name: 'New Rubric',
      created: new Date().toISOString(),
      criteria: [{ id: uid(), name: 'Criterion 1', tagIds: [], levels: { 4: '', 3: '', 2: '', 1: '' } }],
      _isNew: true,
    };
    _rubricDirty = false;
    renderRubricEditor();
  }
  function editRubricUI(rubricId) {
    var rubric = getRubricById(activeCourse, rubricId);
    if (!rubric) return;
    _editingRubric = structuredClone(rubric);
    _rubricDirty = false;
    renderRubricEditor();
  }
  function deleteRubricUI(rubricId) {
    var rubric = getRubricById(activeCourse, rubricId);
    if (!rubric) return;
    var linked = getAssessments(activeCourse).filter(function (a) {
      return a.rubricId === rubricId;
    }).length;
    var msg =
      linked > 0
        ? '"' +
          rubric.name +
          '" is linked to ' +
          linked +
          ' assessment(s). They will lose their rubric link. Delete anyway?'
        : 'Delete rubric "' + rubric.name + '"?';
    showConfirm('Delete Rubric', msg, 'Delete', 'danger', function () {
      deleteRubric(activeCourse, rubricId);
      render();
    });
  }

  function renderRubricEditor() {
    if (!_editingRubric) return;
    var existing = document.getElementById('rubric-modal');
    if (existing) existing.remove();
    var r = _editingRubric;
    var sections = getSections(activeCourse);
    var html =
      '<div class="rubric-modal-overlay" id="rubric-modal" data-action="rubricModalBackdrop" role="dialog" aria-modal="true">' +
      '<div class="rubric-editor"><div class="rubric-editor-header"><h2 class="rubric-editor-title">' +
      (r._isNew ? 'New Rubric' : 'Edit Rubric') +
      '</h2>' +
      '<button class="rubric-editor-close" data-action="cancelRubricEdit" title="Close" aria-label="Close">\u2715</button></div>' +
      '<div class="rubric-editor-body"><input class="rubric-name-input" id="re-name" value="' +
      esc(r.name) +
      '" placeholder="Rubric name\u2026" aria-label="Rubric name"><div id="re-criteria">';
    r.criteria.forEach(function (crit, ci) {
      html += renderCriterionBlock(ci, crit, r.criteria, sections);
    });
    html +=
      '</div></div><div class="rubric-editor-footer"><button class="rubric-add-criterion-btn" data-action="addCriterion">+ Add Criterion</button>' +
      '<button class="btn btn-ghost" data-action="cancelRubricEdit">Cancel</button><button class="btn btn-primary" data-action="saveRubricEdit">Save Rubric</button></div></div></div>';
    document.body.insertAdjacentHTML('beforeend', html);
    _critTagSection = {};
    setTimeout(function () {
      var inp = document.getElementById('re-name');
      if (inp) inp.focus();
    }, 50);
  }
  function renderCriterionBlock(ci, crit, allCriteria, sections) {
    var otherUsed = {};
    allCriteria.forEach(function (c, i) {
      if (i !== ci)
        (c.tagIds || []).forEach(function (t) {
          otherUsed[t] = c.name;
        });
    });
    var selectedTagIds = new Set(crit.tagIds || []);
    var openSecId = _critTagSection[ci] || (sections[0] ? sections[0].id : '');
    var openSec =
      sections.find(function (s) {
        return s.id === openSecId;
      }) || sections[0];
    var isCollapsed = ci !== _expandedCriterion;
    var headerChips = '';
    (crit.tagIds || []).forEach(function (tid) {
      var sec = getSectionForTag(activeCourse, tid);
      var color = sec ? sec.color : 'var(--text-3)';
      headerChips +=
        '<span class="rubric-header-chip" style="background:' +
        color +
        '20;color:' +
        color +
        ';border:1px solid ' +
        color +
        '30">' +
        esc(tid) +
        '</span>';
    });
    // T-UI-09 · per-criterion weight. Any positive number; normalized at read-time (Pass D §1.1).
    var critWeight = crit.weight != null && !isNaN(Number(crit.weight)) ? Number(crit.weight) : 1;
    var html =
      '<div class="rubric-criterion' +
      (isCollapsed ? ' collapsed' : '') +
      '" data-crit-idx="' +
      ci +
      '"><div class="rubric-criterion-header" data-action="toggleCriterionExpand" data-index="' +
      ci +
      '">' +
      '<span class="rubric-criterion-num">' +
      (ci + 1) +
      '</span><input class="rubric-criterion-name" value="' +
      esc(crit.name) +
      '" data-action-blur="critName" data-crit-idx="' +
      ci +
      '" data-stop-prop="true" placeholder="Criterion name">' +
      '<label class="rubric-criterion-weight-label" data-stop-prop="true" title="Relative weight of this criterion (normalized across the rubric).">Weight <input class="rubric-criterion-weight" type="number" min="0" step="0.5" value="' +
      critWeight +
      '" data-action-blur="critWeight" data-action-input="critWeightLive" data-crit-idx="' +
      ci +
      '" data-stop-prop="true" aria-label="Criterion weight"></label>' +
      '<div class="rubric-header-chips">' +
      headerChips +
      '</div><span class="rubric-criterion-chevron">\u25BC</span>' +
      '<button class="rubric-criterion-delete" data-action="removeCriterion" data-index="' +
      ci +
      '" data-stop-prop="true" title="Remove criterion">\u2715</button></div>' +
      '<div class="rubric-criterion-body"><div class="rubric-selected-tags" id="re-sel-' +
      ci +
      '"><span class="rubric-selected-tags-label">Tags:</span>';
    if (selectedTagIds.size === 0) html += '<span class="rubric-no-tags">Click tags below to add them</span>';
    else
      (crit.tagIds || []).forEach(function (tid) {
        var tag = getTagById(activeCourse, tid);
        var sec = getSectionForTag(activeCourse, tid);
        if (tag)
          html +=
            '<span class="rubric-selected-chip" style="border-left:3px solid ' +
            (sec ? sec.color : 'var(--text-3)') +
            '" data-action="toggleCritTag" data-index="' +
            ci +
            '" data-tagid="' +
            tid +
            '" title="Click to remove"><strong>' +
            esc(tid) +
            '</strong> <span class="chip-label">' +
            esc(tag.label) +
            '</span></span>';
      });
    html += '</div><div class="rubric-tag-picker"><div class="rubric-tag-sections">';
    sections.forEach(function (sec) {
      var countInCrit = sec.tags.filter(function (t) {
        return selectedTagIds.has(t.id);
      }).length;
      html +=
        '<button class="rubric-tag-sec-btn' +
        (sec.id === openSecId ? ' active' : '') +
        '" data-action="switchCritSection" data-index="' +
        ci +
        '" data-secid="' +
        sec.id +
        '"><span class="rubric-tag-sec-dot" style="background:' +
        sec.color +
        '"></span>' +
        esc(sec.shortName || sec.name) +
        (countInCrit > 0
          ? '<span class="rubric-tag-sec-count" style="color:' +
            sec.color +
            ';font-weight:700">' +
            countInCrit +
            '</span>'
          : '') +
        '</button>';
    });
    html += '</div><div class="rubric-tag-list" id="re-tags-' + ci + '">';
    if (openSec)
      openSec.tags.forEach(function (tag) {
        var inThis = selectedTagIds.has(tag.id);
        var inOtherName = otherUsed[tag.id];
        var disabled = !!inOtherName;
        html +=
          '<div class="rubric-tag-item' +
          (inThis ? ' selected' : '') +
          (disabled ? ' disabled' : '') +
          '" data-action="' +
          (disabled ? '' : 'toggleCritTag') +
          '" data-index="' +
          ci +
          '" data-tagid="' +
          tag.id +
          '"><input type="checkbox" class="rubric-tag-cb" ' +
          (inThis ? 'checked' : '') +
          ' ' +
          (disabled ? 'disabled' : '') +
          '><span class="rubric-tag-id" style="color:' +
          openSec.color +
          '">' +
          esc(tag.id) +
          '</span><span class="rubric-tag-label">' +
          esc(tag.label) +
          '</span>' +
          (disabled ? '<span class="rubric-tag-used-by">in ' + esc(inOtherName) + '</span>' : '') +
          '</div>';
      });
    html +=
      '</div></div></div><div class="rubric-levels">' +
      '<div class="rubric-level-card"><div class="rubric-level-header"><span class="rubric-level-dot" style="background:var(--score-4)"></span> <span style="color:var(--score-4)">4 \u2014 Extending</span></div><textarea class="rubric-level-text" data-crit="' +
      ci +
      '" data-level="4" data-action-blur="critLevel" placeholder="What does extending look like?">' +
      esc((crit.levels && crit.levels[4]) || '') +
      '</textarea></div>' +
      '<div class="rubric-level-card"><div class="rubric-level-header"><span class="rubric-level-dot" style="background:var(--score-3)"></span> <span style="color:var(--score-3)">3 \u2014 Proficient</span></div><textarea class="rubric-level-text" data-crit="' +
      ci +
      '" data-level="3" data-action-blur="critLevel" placeholder="What does proficient look like?">' +
      esc((crit.levels && crit.levels[3]) || '') +
      '</textarea></div>' +
      '<div class="rubric-level-card"><div class="rubric-level-header"><span class="rubric-level-dot" style="background:var(--score-2)"></span> <span style="color:var(--score-2)">2 \u2014 Developing</span></div><textarea class="rubric-level-text" data-crit="' +
      ci +
      '" data-level="2" data-action-blur="critLevel" placeholder="What does developing look like?">' +
      esc((crit.levels && crit.levels[2]) || '') +
      '</textarea></div>' +
      '<div class="rubric-level-card"><div class="rubric-level-header"><span class="rubric-level-dot" style="background:var(--score-1)"></span> <span style="color:var(--score-1)">1 \u2014 Emerging</span></div><textarea class="rubric-level-text" data-crit="' +
      ci +
      '" data-level="1" data-action-blur="critLevel" placeholder="What does emerging look like?">' +
      esc((crit.levels && crit.levels[1]) || '') +
      '</textarea></div>' +
      '</div>' +
      // T-UI-10 · per-level point value overrides. Defaults closed; 95% of teachers
      // never need this. Overrides are optional — null levelValues means use 4/3/2/1.
      (function () {
        var lv = crit.levelValues || {};
        var v4 = lv[4] != null ? lv[4] : 4;
        var v3 = lv[3] != null ? lv[3] : 3;
        var v2 = lv[2] != null ? lv[2] : 2;
        var v1 = lv[1] != null ? lv[1] : 1;
        var customized = crit.levelValues && Object.keys(crit.levelValues).length > 0;
        return (
          '<details class="rubric-level-values"' +
          (customized ? ' open' : '') +
          ' data-crit-idx="' +
          ci +
          '" data-stop-prop="true">' +
          '<summary class="rubric-level-values-summary" data-stop-prop="true">Customize point values</summary>' +
          '<div class="rubric-level-values-grid">' +
          '<label class="rubric-level-value-label">L4 <input class="rubric-level-value" type="number" step="0.5" value="' +
          v4 +
          '" data-crit="' +
          ci +
          '" data-level="4" data-action-blur="critLevelValue" data-stop-prop="true" aria-label="Level 4 value"></label>' +
          '<label class="rubric-level-value-label">L3 <input class="rubric-level-value" type="number" step="0.5" value="' +
          v3 +
          '" data-crit="' +
          ci +
          '" data-level="3" data-action-blur="critLevelValue" data-stop-prop="true" aria-label="Level 3 value"></label>' +
          '<label class="rubric-level-value-label">L2 <input class="rubric-level-value" type="number" step="0.5" value="' +
          v2 +
          '" data-crit="' +
          ci +
          '" data-level="2" data-action-blur="critLevelValue" data-stop-prop="true" aria-label="Level 2 value"></label>' +
          '<label class="rubric-level-value-label">L1 <input class="rubric-level-value" type="number" step="0.5" value="' +
          v1 +
          '" data-crit="' +
          ci +
          '" data-level="1" data-action-blur="critLevelValue" data-stop-prop="true" aria-label="Level 1 value"></label>' +
          '</div>' +
          '</details>'
        );
      })() +
      '</div>';
    return html;
  }
  function toggleCriterionExpand(idx) {
    _expandedCriterion = _expandedCriterion === idx ? -1 : idx;
    document.querySelectorAll('.rubric-criterion').forEach(function (el, i) {
      if (i === _expandedCriterion) el.classList.remove('collapsed');
      else el.classList.add('collapsed');
    });
  }
  function updateCritName(idx, name) {
    if (!_editingRubric) return;
    _editingRubric.criteria[idx].name = name.trim() || 'Unnamed';
    _rubricDirty = true;
  }
  function updateCritLevel(idx, level, text) {
    if (!_editingRubric) return;
    if (!_editingRubric.criteria[idx].levels) _editingRubric.criteria[idx].levels = {};
    _editingRubric.criteria[idx].levels[level] = text.trim();
    _rubricDirty = true;
  }
  // T-UI-09 · per-criterion weight. Any positive number allowed; normalization
  // happens at read-time (Pass D §1.1). Blank / zero falls back to 1.
  function updateCritWeight(idx, value) {
    if (!_editingRubric) return;
    var v = parseFloat(value);
    _editingRubric.criteria[idx].weight = isNaN(v) || v < 0 ? 1 : v;
    _rubricDirty = true;
  }
  // T-UI-10 · per-level point value override. levelValues is lazily created.
  // Reverting a value back to the default (4/3/2/1) removes the override so
  // the criterion stays "clean" and rendering code can skip the overrides.
  function updateCritLevelValue(idx, level, value) {
    if (!_editingRubric) return;
    var crit = _editingRubric.criteria[idx];
    if (!crit) return;
    var v = parseFloat(value);
    var lvl = parseInt(level, 10);
    var defaults = { 4: 4, 3: 3, 2: 2, 1: 1 };
    if (!crit.levelValues) crit.levelValues = {};
    if (isNaN(v) || v === defaults[lvl]) {
      delete crit.levelValues[lvl];
      if (Object.keys(crit.levelValues).length === 0) crit.levelValues = null;
    } else {
      crit.levelValues[lvl] = v;
    }
    _rubricDirty = true;
  }
  function toggleCritTag(critIdx, tagId) {
    if (!_editingRubric) return;
    _rubricDirty = true;
    var crit = _editingRubric.criteria[critIdx];
    if (!crit.tagIds) crit.tagIds = [];
    var i = crit.tagIds.indexOf(tagId);
    if (i >= 0) crit.tagIds.splice(i, 1);
    else crit.tagIds.push(tagId);
    _refreshCriterionDOM(critIdx);
  }
  function switchCritSection(critIdx, secId) {
    _critTagSection[critIdx] = secId;
    _refreshCriterionDOM(critIdx);
  }
  function _refreshCriterionDOM(ci) {
    if (!_editingRubric) return;
    // Full re-render of criteria section (simpler than partial DOM updates in module context)
    var mount = document.getElementById('re-criteria');
    if (!mount) return;
    var sections = getSections(activeCourse);
    var h = '';
    _editingRubric.criteria.forEach(function (c, i) {
      h += renderCriterionBlock(i, c, _editingRubric.criteria, sections);
    });
    mount.innerHTML = h;
  }
  function addCriterion() {
    if (!_editingRubric) return;
    _rubricDirty = true;
    var num = _editingRubric.criteria.length + 1;
    // T-UI-09 · weight defaults to 1.0 (normalized across rubric at read-time).
    // T-UI-10 · levelValues null means use defaults (4/3/2/1) — only set when
    // teacher customizes via the disclosure.
    _editingRubric.criteria.push({
      id: uid(),
      name: 'Criterion ' + num,
      tagIds: [],
      levels: { 4: '', 3: '', 2: '', 1: '' },
      weight: 1,
      levelValues: null,
    });
    _expandedCriterion = _editingRubric.criteria.length - 1;
    _refreshCriterionDOM(_expandedCriterion);
  }
  function removeCriterion(idx) {
    if (!_editingRubric) return;
    if (_editingRubric.criteria.length <= 1) {
      alert('A rubric needs at least one criterion.');
      return;
    }
    _rubricDirty = true;
    _editingRubric.criteria.splice(idx, 1);
    if (idx < _expandedCriterion) _expandedCriterion--;
    else if (idx === _expandedCriterion) _expandedCriterion = -1;
    _refreshCriterionDOM(0);
  }
  function cancelRubricEdit() {
    if (_rubricDirty && !confirm('Discard unsaved rubric changes?')) return;
    _editingRubric = null;
    _rubricDirty = false;
    var modal = document.getElementById('rubric-modal');
    if (modal) modal.remove();
  }
  function saveRubricEdit() {
    if (!_editingRubric) return;
    var nameInput = document.getElementById('re-name');
    var rubricName = (nameInput ? nameInput.value : '').trim();
    if (!rubricName) {
      if (nameInput) {
        nameInput.style.border = '2px solid var(--score-1)';
        nameInput.placeholder = 'Rubric name is required';
        nameInput.focus();
      }
      return;
    }
    _editingRubric.name = rubricName;
    if (!_editingRubric.criteria || _editingRubric.criteria.length === 0) {
      alert('Add at least one criterion.');
      return;
    }
    for (var i = 0; i < _editingRubric.criteria.length; i++) {
      if (!_editingRubric.criteria[i].tagIds || _editingRubric.criteria[i].tagIds.length === 0) {
        alert('Criterion "' + _editingRubric.criteria[i].name + '" needs at least one tag.');
        return;
      }
    }
    var cid = activeCourse;
    var rubrics = structuredClone(getRubrics(cid));
    var isNew = _editingRubric._isNew;
    delete _editingRubric._isNew;
    if (isNew) rubrics.push(_editingRubric);
    else {
      var idx = rubrics.findIndex(function (r) {
        return r.id === _editingRubric.id;
      });
      if (idx >= 0) rubrics[idx] = _editingRubric;
      else rubrics.push(_editingRubric);
    }
    var savedId = _editingRubric.id;
    var criteriaCount = (_editingRubric.criteria || []).length;
    var savePromise = saveRubrics(cid, rubrics);
    _editingRubric = null;
    _rubricDirty = false;
    var modal = document.getElementById('rubric-modal');
    if (modal) modal.remove();
    render();
    Promise.resolve(savePromise).then(function (result) {
      setTimeout(function () {
        var dd = document.getElementById('af-rubric');
        if (!dd) return;
        var freshRubrics = result && Array.isArray(result.rubrics) ? result.rubrics : getRubrics(cid);
        dd.innerHTML =
          '<option value="">None</option>' +
          freshRubrics
            .map(function (r) {
              return '<option value="' + r.id + '">' + esc(r.name) + ' (' + r.criteria.length + ' criteria)</option>';
            })
            .join('');
        var finalId = result && result.idMap && result.idMap[savedId] ? result.idMap[savedId] : savedId;
        if (
          !freshRubrics.find(function (r) {
            return r.id === finalId;
          })
        ) {
          var fallback = freshRubrics.find(function (r) {
            return r.name === rubricName && (r.criteria || []).length === criteriaCount;
          });
          if (fallback) finalId = fallback.id;
        }
        if (isNew && finalId) {
          dd.value = finalId;
          onRubricSelect(finalId);
        }
      }, 100);
    });
  }
  function newRubricFromForm() {
    newRubricUI();
  }

  /* ── Comment Popover ────────────────────────────────────── */
  function openCommentPopover(cid, sid, aid) {
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var student = getStudents(cid).find(function (s) {
      return s.id === sid;
    });
    if (!assess || !student) return;
    _commentPopoverState = { cid: cid, sid: sid, aid: aid };
    renderCommentPopover();
  }
  function renderCommentPopover() {
    if (!_commentPopoverState) return;
    var cid = _commentPopoverState.cid,
      sid = _commentPopoverState.sid,
      aid = _commentPopoverState.aid;
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var student = getStudents(cid).find(function (s) {
      return s.id === sid;
    });
    if (!assess || !student) return;
    var obs = getAssignmentObs(cid, sid, aid);
    var entriesHtml = '';
    if (obs.length === 0) entriesHtml = '<div class="comment-popover-empty">No comments yet</div>';
    else {
      entriesHtml =
        '<div class="comment-popover-entries">' +
        obs
          .map(function (o) {
            var d = new Date(o.created);
            var ds = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            return (
              '<div class="comment-entry"><span class="comment-entry-date">' +
              ds +
              '</span><span class="comment-entry-text">' +
              esc(o.text) +
              '</span><button class="comment-entry-del" data-action="deleteComment" data-obid="' +
              o.id +
              '" data-stop-prop="true" title="Delete">\u2715</button></div>'
            );
          })
          .join('') +
        '</div>';
    }
    var overlay = document.getElementById('comment-popover-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'comment-popover-overlay';
      overlay.className = 'comment-popover-overlay';
      overlay.onclick = function (e) {
        if (e.target === this) closeCommentPopover();
      };
      document.body.appendChild(overlay);
    }
    overlay.innerHTML =
      '<div class="comment-popover"><div class="comment-popover-header"><div><div class="comment-popover-title">' +
      esc(displayName(student)) +
      '</div><div class="comment-popover-subtitle">' +
      esc(assess.title) +
      '</div></div><button class="comment-popover-close" data-action="closeCommentPopover" aria-label="Close">\u2715</button></div><div class="comment-popover-body">' +
      entriesHtml +
      '</div><div class="comment-popover-footer"><input class="comment-popover-input" id="comment-input" placeholder="Add a comment\u2026" autofocus><button class="comment-popover-submit" data-action="submitComment">Add</button></div></div>';
    overlay.style.display = 'flex';
    setTimeout(function () {
      var inp = document.getElementById('comment-input');
      if (inp) inp.focus();
    }, 50);
  }
  function submitComment() {
    if (!_commentPopoverState) return;
    var cid = _commentPopoverState.cid,
      sid = _commentPopoverState.sid,
      aid = _commentPopoverState.aid;
    var inp = document.getElementById('comment-input');
    if (!inp) return;
    var text = inp.value.trim();
    if (!text) return;
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    if (!assess) return;
    addQuickOb(cid, sid, text, [], null, null, { assessmentId: aid, assessmentTitle: assess.title });
    renderCommentPopover();
    updateCommentBadge(sid, aid);
  }
  function deleteComment(obId) {
    if (!_commentPopoverState) return;
    var cid = _commentPopoverState.cid,
      sid = _commentPopoverState.sid,
      aid = _commentPopoverState.aid;
    deleteQuickOb(cid, sid, obId);
    renderCommentPopover();
    updateCommentBadge(sid, aid);
  }
  function closeCommentPopover() {
    _commentPopoverState = null;
    var overlay = document.getElementById('comment-popover-overlay');
    if (overlay) overlay.style.display = 'none';
  }
  function updateCommentBadge(sid, aid) {
    var cid = activeCourse;
    var count = getAssignmentObs(cid, sid, aid).length;
    document.querySelectorAll('.comment-btn').forEach(function (btn) {
      if (btn.dataset.sid === sid && btn.dataset.aid === aid)
        btn.innerHTML = count > 0 ? 'Comment <span class="comment-count">' + count + '</span>' : 'Comment';
    });
  }

  /* ── Advanced settings ──────────────────────────────────── */
  function updateCalc(val) {
    var cc = getCourseConfig(activeCourse);
    cc.calcMethod = val;
    saveCourseConfig(activeCourse, cc);
    var dr = document.getElementById('decay-row');
    if (dr) dr.style.display = val === 'decayingAvg' ? 'flex' : 'none';
  }
  function updateDecay(val) {
    var dv = document.getElementById('decay-val');
    if (dv) dv.textContent = val + '%';
    var cc = getCourseConfig(activeCourse);
    cc.decayWeight = parseInt(val, 10) / 100;
    saveCourseConfig(activeCourse, cc);
  }
  function renderGradingScaleEditor(cid) {
    var scale = getGradingScale(cid);
    var b = scale.boundaries;
    var labels = scale.labels || [null, null, null, null];
    var defaultLabels = ['Emerging', 'Developing', 'Proficient', 'Extending'];
    var html =
      '<div class="settings-title" style="margin-top:16px;padding-top:12px;border-top:0.5px solid var(--divider-subtle)">Grading Scale</div><div style="font-size:0.72rem;color:var(--text-3);margin-bottom:8px">Set % boundaries for points \u2192 proficiency conversion</div><table style="width:100%;border-collapse:collapse;font-size:0.8rem"><thead><tr style="text-align:left;color:var(--text-3);font-size:0.68rem;text-transform:uppercase;letter-spacing:0.04em"><th style="padding:4px 8px;width:40px">Level</th><th style="padding:4px 8px">Label</th><th style="padding:4px 8px;width:70px">Min %</th></tr></thead><tbody>';
    for (var i = 0; i < b.length; i++) {
      var prof = b[i].proficiency;
      var label = (labels && labels[prof - 1]) || defaultLabels[prof - 1];
      var isBottom = i === b.length - 1;
      html +=
        '<tr style="border-bottom:1px solid var(--divider-subtle)"><td style="padding:6px 8px;font-weight:600;color:var(--text-2)">' +
        prof +
        '</td><td style="padding:6px 8px"><input class="af-input gs-label" data-prof="' +
        prof +
        '" value="' +
        esc(label) +
        '" data-action-change="saveGradingScale" style="font-size:0.8rem;padding:4px 8px"></td><td style="padding:6px 8px">' +
        (isBottom
          ? '<span style="color:var(--text-3)">0</span>'
          : '<input class="af-input gs-min" data-idx="' +
            i +
            '" type="number" min="1" max="99" value="' +
            b[i].min +
            '" data-action-change="saveGradingScale" style="font-size:0.8rem;padding:4px 8px;width:60px;text-align:center">') +
        '</td></tr>';
    }
    html +=
      '</tbody></table><button class="btn btn-ghost" data-action="resetGradingScale" style="font-size:0.72rem;margin-top:6px;padding:4px 10px">Reset to Defaults</button>';
    return html;
  }
  function saveGradingScale() {
    var cc = getCourseConfig(activeCourse);
    var boundaries = [];
    var labels = [null, null, null, null];
    document.querySelectorAll('.gs-label').forEach(function (inp) {
      var prof = parseInt(inp.dataset.prof, 10);
      labels[prof - 1] = inp.value.trim() || null;
    });
    DEFAULT_GRADING_SCALE.boundaries.forEach(function (db, i) {
      var inp = document.querySelector('.gs-min[data-idx="' + i + '"]');
      boundaries.push({
        min: inp ? Math.max(0, Math.min(99, parseInt(inp.value, 10) || 0)) : 0,
        proficiency: db.proficiency,
      });
    });
    cc.gradingScale = { boundaries: boundaries, labels: labels };
    saveCourseConfig(activeCourse, cc);
  }
  function resetGradingScale() {
    var cc = getCourseConfig(activeCourse);
    delete cc.gradingScale;
    saveCourseConfig(activeCourse, cc);
    render();
  }
  function renderCategoryWeightsEditor(cid) {
    var cw = getCategoryWeights(cid);
    var enabled = cw.formative > 0;
    var summPct = Math.round((cw.summative || 1) * 100);
    var formPct = Math.round((cw.formative || 0) * 100);
    return (
      '<div class="settings-title" style="margin-top:16px;padding-top:12px;border-top:0.5px solid var(--divider-subtle)">Category Weights</div>' +
      '<div class="settings-row" style="align-items:center;gap:8px"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.82rem"><input type="checkbox" id="cw-enabled" ' +
      (enabled ? 'checked' : '') +
      ' data-action-change="toggleCategoryWeights" style="width:16px;height:16px"> Weight formative assessments</label></div>' +
      '<div id="cw-sliders" style="display:' +
      (enabled ? '' : 'none') +
      ';margin-top:8px"><div style="display:flex;gap:16px;align-items:center;font-size:0.82rem"><div style="flex:1"><label style="color:var(--text-2)">Summative</label><div style="display:flex;align-items:center;gap:6px"><input type="range" id="cw-range" min="0" max="100" value="' +
      summPct +
      '" data-action-input="updateCategoryWeightsSlider" style="flex:1"><span id="cw-summ-val" style="width:36px;text-align:right;font-weight:600">' +
      summPct +
      '%</span></div></div><div style="flex:1"><label style="color:var(--text-2)">Formative</label><div style="display:flex;align-items:center;gap:6px"><div style="flex:1;text-align:center;color:var(--text-3)">\u2190</div><span id="cw-form-val" style="width:36px;text-align:right;font-weight:600">' +
      formPct +
      '%</span></div></div></div></div>'
    );
  }
  function toggleCategoryWeights(on) {
    var sl = document.getElementById('cw-sliders');
    if (sl) sl.style.display = on ? '' : 'none';
    if (!on) {
      var cc = getCourseConfig(activeCourse);
      cc.categoryWeights = { summative: 1.0, formative: 0.0 };
      saveCourseConfig(activeCourse, cc);
    } else {
      updateCategoryWeights(70);
      var r = document.getElementById('cw-range');
      if (r) r.value = 70;
    }
  }
  function updateCategoryWeights(summPct) {
    summPct = Math.max(0, Math.min(100, parseInt(summPct, 10) || 0));
    var formPct = 100 - summPct;
    var sv = document.getElementById('cw-summ-val');
    if (sv) sv.textContent = summPct + '%';
    var fv = document.getElementById('cw-form-val');
    if (fv) fv.textContent = formPct + '%';
    var cc = getCourseConfig(activeCourse);
    cc.categoryWeights = { summative: summPct / 100, formative: formPct / 100 };
    saveCourseConfig(activeCourse, cc);
  }

  /* ── Module management ──────────────────────────────────── */
  function updateModuleName(moduleId, name) {
    var cid = activeCourse;
    var modules = getModules(cid);
    var u = modules.find(function (x) {
      return x.id === moduleId;
    });
    if (u && name.trim()) {
      u.name = name.trim();
      saveModules(cid, modules);
    }
  }
  function updateModuleColor(moduleId, color) {
    var cid = activeCourse;
    var modules = getModules(cid);
    var u = modules.find(function (x) {
      return x.id === moduleId;
    });
    if (u) {
      u.color = color;
      saveModules(cid, modules);
      render();
    }
  }
  function deleteModule(moduleId, assessCount) {
    var msg =
      assessCount > 0
        ? assessCount + ' assessment(s) use this module. They will become unassigned. Delete anyway?'
        : 'Delete this module?';
    showConfirm('Delete Module', msg, 'Delete', 'danger', function () {
      var cid = activeCourse;
      saveModules(
        cid,
        getModules(cid).filter(function (u) {
          return u.id !== moduleId;
        }),
      );
      var assessments = getAssessments(cid);
      assessments.forEach(function (a) {
        if (a.moduleId === moduleId) delete a.moduleId;
      });
      saveAssessments(cid, assessments);
      render();
    });
  }
  function toggleModuleFolder(moduleId) {
    collapsedModules[moduleId] = !collapsedModules[moduleId];
    var folder = document.querySelector('.mod-folder[data-module-id="' + moduleId + '"]');
    if (folder) folder.classList.toggle('open', !collapsedModules[moduleId]);
  }
  function addModuleInline() {
    var cid = activeCourse;
    var modules = getModules(cid);
    var idx = modules.length;
    var color = MODULE_COLORS[idx % MODULE_COLORS.length];
    var newModule = {
      id: uid(),
      name: 'Module ' + (idx + 1),
      color: color,
      sortOrder: idx,
      created: new Date().toISOString(),
    };
    modules.push(newModule);
    saveModules(cid, modules);
    collapsedModules[newModule.id] = false;
    render();
    setTimeout(function () {
      var input = document.querySelector('.mod-folder[data-module-id="' + newModule.id + '"] .mod-folder-name-input');
      if (input) {
        input.focus();
        input.select();
      }
    }, 50);
  }

  /* ── Drag & Drop — modules and assessments ──────────────── */
  function onModuleDragStart(event, moduleId) {
    _dragModuleId = moduleId;
    _dragAssessId = null;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/module-id', moduleId);
    setTimeout(function () {
      var el = document.querySelector('.mod-folder[data-module-id="' + moduleId + '"]');
      if (el) el.classList.add('dragging');
    }, 0);
  }
  function onModuleDragEnd() {
    _dragModuleId = null;
    document.querySelectorAll('.mod-folder.dragging').forEach(function (el) {
      el.classList.remove('dragging');
    });
    document.querySelectorAll('.mod-drop-zone.drag-over').forEach(function (el) {
      el.classList.remove('drag-over');
    });
  }
  function onModuleDropZoneDrop(event, targetIndex) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    var moduleId = _dragModuleId || event.dataTransfer.getData('application/module-id');
    if (!moduleId) return;
    var cid = activeCourse;
    var modules = getModules(cid);
    var fromIndex = modules.findIndex(function (u) {
      return u.id === moduleId;
    });
    if (fromIndex < 0) return;
    var moved = modules.splice(fromIndex, 1)[0];
    var insertAt = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
    modules.splice(insertAt, 0, moved);
    saveModules(cid, modules);
    _dragModuleId = null;
    render();
  }
  function onAssessDragStart(event, assessId) {
    event.stopPropagation();
    _dragAssessId = assessId;
    _dragModuleId = null;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', assessId);
    setTimeout(function () {
      var el = document.getElementById('ac-' + assessId);
      if (el) el.classList.add('dragging');
    }, 0);
  }
  function onAssessDragEnd() {
    _dragAssessId = null;
    _clearMergeState();
    document.querySelectorAll('.assess-card.dragging').forEach(function (el) {
      el.classList.remove('dragging');
    });
    document.querySelectorAll('.mod-folder.drag-over').forEach(function (el) {
      el.classList.remove('drag-over');
    });
    document.querySelectorAll('.assess-card.merge-target').forEach(function (el) {
      el.classList.remove('merge-target');
    });
  }
  function onFolderDrop(event, targetModuleId) {
    if (_dragModuleId) return;
    event.preventDefault();
    var assessId = event.dataTransfer.getData('text/plain') || _dragAssessId;
    if (!assessId) return;
    var cid = activeCourse;
    var assessments = getAssessments(cid);
    var a = assessments.find(function (x) {
      return x.id === assessId;
    });
    if (!a) return;
    if (targetModuleId === '__none__') delete a.moduleId;
    else a.moduleId = targetModuleId;
    saveAssessments(cid, assessments);
    _dragAssessId = null;
    render();
  }
  function _clearMergeState() {
    if (_mergeHoverTimer) {
      clearTimeout(_mergeHoverTimer);
      _mergeHoverTimer = null;
    }
    if (_mergeTargetId) {
      var el = document.getElementById('ac-' + _mergeTargetId);
      if (el) el.classList.remove('merge-target');
    }
    _mergeTargetId = null;
    _mergeAnimating = false;
  }
  function mergeToNewModule(draggedId, targetId) {
    var cid = activeCourse;
    var modules = getModules(cid);
    var idx = modules.length;
    var color = MODULE_COLORS[idx % MODULE_COLORS.length];
    var newModule = {
      id: uid(),
      name: 'Module ' + (idx + 1),
      color: color,
      sortOrder: idx,
      created: new Date().toISOString(),
    };
    modules.push(newModule);
    saveModules(cid, modules);
    var assessments = getAssessments(cid);
    [draggedId, targetId].forEach(function (aid) {
      var a = assessments.find(function (x) {
        return x.id === aid;
      });
      if (a) a.moduleId = newModule.id;
    });
    saveAssessments(cid, assessments);
    collapsedModules[newModule.id] = false;
    render();
    setTimeout(function () {
      var input = document.querySelector('.mod-folder[data-module-id="' + newModule.id + '"] .mod-folder-name-input');
      if (input) {
        input.focus();
        input.select();
      }
    }, 50);
  }

  /* ── Export / Import ────────────────────────────────────── */
  function exportData() {
    var cid = activeCourse;
    var data = {
      course: cid,
      students: getStudents(cid),
      categories: getCategories(cid),
      assessments: getAssessments(cid),
      scores: getScores(cid),
      overrides: getOverrides(cid),
      notes: getNotes(cid),
      config: getCourseConfig(cid),
      learningMap: getLearningMap(cid),
      modules: getModules(cid),
      rubrics: getRubrics(cid),
      statuses: getAssignmentStatuses(cid),
      flags: getFlags(cid),
      goals: getGoals(cid),
      reflections: getReflections(cid),
      observations: getQuickObs(cid),
      termRatings: getTermRatings(cid),
      customTags: getCustomTags(cid),
      reportConfig: getReportConfig(cid),
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gradebook-' + cid + '-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
  }
  function importData(input) {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          alert('Invalid file.');
          return;
        }
        var cid = data.course || activeCourse;
        if (data.students) saveStudents(cid, data.students);
        if (data.categories) saveCategories(cid, data.categories);
        if (data.assessments) saveAssessments(cid, data.assessments);
        if (data.scores) saveScores(cid, data.scores);
        if (data.overrides) saveOverrides(cid, data.overrides);
        if (data.notes) saveNotes(cid, data.notes);
        if (data.config) saveCourseConfig(cid, data.config);
        if (data.learningMap && data.learningMap._customized) saveLearningMap(cid, data.learningMap);
        if (data.modules) saveModules(cid, data.modules);
        if (data.units) saveModules(cid, data.units);
        if (data.rubrics) saveRubrics(cid, data.rubrics);
        if (data.statuses) saveAssignmentStatuses(cid, data.statuses);
        if (data.flags) saveFlags(cid, data.flags);
        if (data.goals) saveGoals(cid, data.goals);
        if (data.reflections) saveReflections(cid, data.reflections);
        if (data.observations) saveQuickObs(cid, data.observations);
        if (data.termRatings) saveTermRatings(cid, data.termRatings);
        if (data.customTags) saveCustomTags(cid, data.customTags);
        if (data.reportConfig) saveReportConfig(cid, data.reportConfig);
        activeCourse = cid;
        setActiveCourse(cid);
        render();
      } catch (err) {
        alert('Invalid JSON: ' + err.message);
      }
    };
    reader.readAsText(file);
  }
  function downloadCSV(csv, filename) {
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }
  function exportScoresCSV() {
    var cid = activeCourse;
    var students = sortStudents(getStudents(cid), 'lastName');
    var assessments = getAssessments(cid);
    var scores = getScores(cid);
    var statuses = getAssignmentStatuses(cid);
    var csv = 'Student,Assessment,Date,Category,Tag,Tag Label,Score,Status\n';
    students.forEach(function (st) {
      assessments.forEach(function (a) {
        var stStatus = statuses[st.id + ':' + a.id] || '';
        var categoryName = _getCategoryName(cid, _getAssessmentCategoryId(a));
        (a.tagIds || []).forEach(function (tid) {
          var tag = getTagById(cid, tid);
          var entry = (scores[st.id] || []).find(function (s) {
            return s.assessmentId === a.id && s.tagId === tid;
          });
          var score = entry ? entry.score : 0;
          csv +=
            '"' +
            displayName(st).replace(/"/g, '""') +
            '","' +
            a.title.replace(/"/g, '""') +
            '","' +
            a.date +
            '","' +
            categoryName.replace(/"/g, '""') +
            '","' +
            tid +
            '","' +
            (tag ? tag.label.replace(/"/g, '""') : '') +
            '","' +
            score +
            '","' +
            stStatus +
            '"\n';
        });
      });
    });
    downloadCSV(csv, 'scores-' + cid + '-' + new Date().toISOString().slice(0, 10) + '.csv');
  }
  function exportSummaryCSV() {
    var cid = activeCourse;
    var students = sortStudents(getStudents(cid), 'lastName');
    var sections = getSections(cid);
    var csv = 'Student,Overall';
    sections.forEach(function (sec) {
      csv += ',"' + sec.name.replace(/"/g, '""') + '"';
    });
    csv += '\n';
    students.forEach(function (st) {
      var overall = getOverallProficiency(cid, st.id);
      csv += '"' + displayName(st).replace(/"/g, '""') + '","' + (overall > 0 ? overall.toFixed(1) : '') + '"';
      sections.forEach(function (sec) {
        var sp = getSectionProficiency(cid, st.id, sec.id);
        csv += ',"' + (sp > 0 ? sp.toFixed(1) : '') + '"';
      });
      csv += '\n';
    });
    downloadCSV(csv, 'summary-' + cid + '-' + new Date().toISOString().slice(0, 10) + '.csv');
  }
  function clearData() {
    if (!activeCourse || !COURSES[activeCourse]) return;
    showConfirm(
      'Delete Class',
      'Delete ' + COURSES[activeCourse].name + '? It will be hidden immediately and permanently removed after 30 days.',
      'Delete Class',
      'danger',
      async function () {
        try {
          await deleteCourseData(activeCourse);
        } catch (err) {
          console.error('deleteCourseData failed:', err);
          showSyncToast('Delete class failed. Try again.', 'error');
          return;
        }

        // Local/demo mode still expects a seed course after deleting the last class.
        if (Object.keys(COURSES).length === 0 && (!_useSupabase || localStorage.getItem('gb-demo-mode') === '1')) {
          Object.assign(COURSES, structuredClone(DEFAULT_COURSES));
          saveCourses(COURSES);
          loadSeedIfNeeded();
        }
        Router.navigate('/dashboard');
      },
    );
  }
  function resetDemoData() {
    showConfirm(
      'Reset Demo Data',
      'Reset ALL data to demo defaults? This cannot be undone.',
      'Reset',
      'danger',
      async function () {
        await Promise.all(
          Object.keys(COURSES).map(function (cid) {
            return deleteCourseData(cid);
          }),
        );
        Object.keys(COURSES).forEach(function (cid) {
          delete COURSES[cid];
        });
        Object.assign(COURSES, structuredClone(DEFAULT_COURSES));
        saveCourses(COURSES);
        loadSeedIfNeeded();
        Router.navigate('/dashboard');
      },
    );
  }

  /* ── Keyboard Navigation ────────────────────────────────── */
  function kbFocusCell(el) {
    if (_kbFocusEl) _kbFocusEl.classList.remove('kb-focus');
    _kbFocusEl = el;
    if (el) {
      el.classList.add('kb-focus');
      el.scrollIntoView({ block: 'nearest' });
    }
  }
  function navigateKb(direction) {
    if (!_kbFocusEl) return;
    if (_kbFocusEl.classList.contains('rsg-criterion-row')) {
      var grid = _kbFocusEl.closest('.rsg-grid');
      if (!grid) return;
      var allCritRows = Array.from(grid.querySelectorAll('.rsg-criterion-row'));
      var curIdx = allCritRows.indexOf(_kbFocusEl);
      if (curIdx < 0) return;
      var newIdx = curIdx;
      if (direction === 'up' || direction === 'left') newIdx = Math.max(0, curIdx - 1);
      else if (direction === 'down' || direction === 'right') newIdx = Math.min(allCritRows.length - 1, curIdx + 1);
      if (allCritRows[newIdx]) kbFocusCell(allCritRows[newIdx]);
    }
  }

  /* ── Delegated click handler ────────────────────────────── */
  function _handleClick(e) {
    // KB focus on score cells
    var critRow = e.target.closest('.rsg-criterion-row');
    if (critRow) {
      kbFocusCell(critRow);
    } else if (_kbFocusEl && !e.target.closest('.col-fill-menu') && !e.target.closest('.row-fill-btn')) {
      kbFocusCell(null);
    }

    // Close menus on click outside
    if (
      !e.target.closest('.col-fill-menu') &&
      !e.target.closest('.score-col-header') &&
      !e.target.closest('.row-fill-btn')
    )
      closeMenus();

    // Close toolbar dropdowns on click outside
    if (!e.target.closest('.tb-dropdown-wrap')) {
      if (_rubricsPanelOpen || _advancedPanelOpen) {
        _rubricsPanelOpen = false;
        _advancedPanelOpen = false;
        var rp = document.getElementById('tb-rubrics-panel');
        var ap = document.getElementById('tb-advanced-panel');
        if (rp) rp.classList.remove('open');
        if (ap) ap.classList.remove('open');
        document.querySelectorAll('.tb-dropdown-btn').forEach(function (btn) {
          btn.classList.remove('open');
        });
      }
    }

    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.dataset.action;
    if (el.dataset.stopProp === 'true') e.stopPropagation();
    var handlers = {
      showNewForm: function () {
        showNewForm();
      },
      hideNewForm: function () {
        hideNewForm();
      },
      toggleAssess: function () {
        toggleAssess(el.dataset.aid);
      },
      editAssess: function () {
        editAssess(el.dataset.aid);
      },
      dupeAssess: function () {
        dupeAssess(el.dataset.aid);
      },
      deleteAssess: function () {
        deleteAssess(el.dataset.aid);
      },
      saveNewAssess: function () {
        saveNewAssess();
      },
      saveEditAssess: function () {
        saveEditAssess(el.dataset.aid);
      },
      toggleModuleFolder: function () {
        toggleModuleFolder(el.dataset.uid);
      },
      deleteModule: function () {
        deleteModule(el.dataset.uid, parseInt(el.dataset.count, 10));
      },
      addModuleInline: function () {
        addModuleInline();
      },
      openColorPicker: function () {
        el.querySelector('input').click();
      },
      setRubricView: function () {
        setRubricView(el.dataset.aid, el.dataset.rubric === 'true');
      },
      editRubricUI: function () {
        editRubricUI(el.dataset.rid);
      },
      deleteRubricUI: function () {
        deleteRubricUI(el.dataset.rid);
      },
      newRubricUI: function () {
        newRubricUI();
      },
      newRubricFromForm: function () {
        newRubricFromForm();
      },
      setCollaboration: function () {
        setCollaboration(el.dataset.collab);
      },
      setScoreMode: function () {
        setScoreMode(el.dataset.mode);
      },
      setAssessTypeFilter: function () {
        setAssessTypeFilter(el.dataset.type);
      },
      toggleUngraded: function () {
        showUngraded = !showUngraded;
        render();
      },
      expandAllAssess: function () {
        expandAllAssess();
      },
      collapseAllAssess: function () {
        collapseAllAssess();
      },
      clearFocusStudent: function () {
        clearFocusStudent();
      },
      toggleToolbarDropdown: function () {
        toggleToolbarDropdown(el.dataset.panel);
      },
      exportData: function () {
        exportData();
      },
      triggerImportJSON: function () {
        var f = document.getElementById('import-json-input');
        if (f) f.click();
      },
      exportScoresCSV: function () {
        exportScoresCSV();
      },
      exportSummaryCSV: function () {
        exportSummaryCSV();
      },
      clearData: function () {
        clearData();
      },
      resetDemoData: function () {
        resetDemoData();
      },
      openRubricPanel: function () {
        _advancedPanelOpen = false;
        _rubricsPanelOpen = true;
        var ap = document.getElementById('tb-advanced-panel');
        var rp = document.getElementById('tb-rubrics-panel');
        if (ap) ap.classList.remove('open');
        if (rp) {
          rp.classList.add('open');
        }
        document.querySelectorAll('.tb-dropdown-btn').forEach(function (btn) {
          btn.classList.add('open');
        });
      },
      clearAssessFilters: function () {
        e.preventDefault();
        assessFilterType = 'all';
        assessSearch = '';
        showUngraded = false;
        render();
      },
      selectTagLevel: function () {
        selectTagLevel(el, parseInt(el.dataset.level, 10), el.dataset.aid, el.dataset.sid, el.dataset.tagid);
      },
      selectRubricScore: function () {
        selectRubricScore(el, parseInt(el.dataset.level, 10), el.dataset.aid, el.dataset.sid, el.dataset.critid);
      },
      toggleScoreMenu: function () {
        toggleScoreMenu(el);
      },
      fillScoresAndClose: function () {
        fillScores(el.dataset.aid, el.dataset.sid, parseInt(el.dataset.score, 10), el.dataset.scope);
        closeMenus();
      },
      fillRubricScoresAndClose: function () {
        fillRubricScores(el.dataset.aid, el.dataset.sid, parseInt(el.dataset.score, 10), el.dataset.scope);
        closeMenus();
      },
      confirmFillAll: function () {
        confirmFillAll(el.dataset.aid, parseInt(el.dataset.score, 10), el.dataset.label);
      },
      confirmFillRubricAll: function () {
        confirmFillRubricAll(el.dataset.aid, parseInt(el.dataset.score, 10), el.dataset.label);
      },
      toggleStudentStatus: function () {
        toggleStudentStatus(el.dataset.aid, el.dataset.sid, el.dataset.status);
      },
      openCommentPopover: function () {
        openCommentPopover(el.dataset.cid, el.dataset.sid, el.dataset.aid);
      },
      closeCommentPopover: function () {
        closeCommentPopover();
      },
      submitComment: function () {
        submitComment();
      },
      deleteComment: function () {
        deleteComment(el.dataset.obid);
      },
      toggleSectionTags: function () {
        toggleSectionTags(el.dataset.secid);
      },
      toggleSectionOpen: function () {
        el.parentElement.classList.toggle('af-section-open');
      },
      toggleActive: function () {
        el.classList.toggle('active');
      },
      collabCheckAll: function () {
        collabCheckAll();
      },
      collabCheckNone: function () {
        collabCheckNone();
      },
      collabRandomPairs: function () {
        collabPairMode = 'random';
        collabRandomPairs();
      },
      collabManualPairs: function () {
        collabPairMode = 'manual';
        renderCollabPanel();
      },
      collabRandomGroups: function () {
        collabGroupMode = 'random';
        collabRandomGroups();
      },
      collabManualGroups: function () {
        collabGroupMode = 'manual';
        renderCollabPanel();
      },
      collabSetGroupCount: function () {
        collabSetGroupCount(parseInt(el.dataset.delta, 10));
      },
      rubricModalBackdrop: function () {
        if (e.target === el) cancelRubricEdit();
      },
      cancelRubricEdit: function () {
        cancelRubricEdit();
      },
      saveRubricEdit: function () {
        saveRubricEdit();
      },
      addCriterion: function () {
        addCriterion();
      },
      toggleCriterionExpand: function () {
        toggleCriterionExpand(parseInt(el.dataset.index, 10));
      },
      removeCriterion: function () {
        removeCriterion(parseInt(el.dataset.index, 10));
      },
      toggleCritTag: function () {
        toggleCritTag(parseInt(el.dataset.index, 10), el.dataset.tagid);
      },
      switchCritSection: function () {
        switchCritSection(parseInt(el.dataset.index, 10), el.dataset.secid);
      },
      resetGradingScale: function () {
        resetGradingScale();
      },
      setMaxPoints: function () {
        var mp = document.getElementById('af-maxpoints');
        if (mp) mp.value = el.dataset.value;
        document.querySelectorAll('#af-maxpoints-picks .af-chip').forEach(function (c) {
          c.classList.remove('active');
        });
        el.classList.add('active');
      },
    };
    if (handlers[action]) {
      if (action !== 'rubricModalBackdrop' && el.tagName !== 'SELECT') e.preventDefault();
      handlers[action]();
    }
  }

  /* ── Input/change/blur handler ──────────────────────────── */
  function _handleInput(e) {
    var el = e.target;
    if (el.dataset.actionInput === 'assessSearch') {
      setAssessSearch(el.value);
      return;
    }
    if (el.dataset.actionInput === 'updateDecaySlider') {
      updateDecay(el.value);
      return;
    }
    if (el.dataset.actionInput === 'updateCategoryWeightsSlider') {
      updateCategoryWeights(el.value);
      return;
    }
    // T-UI-09 · live weight mutation (mark dirty, no re-render — weight shows up
    // in the input itself, so the input's own value stays in sync).
    if (el.dataset.actionInput === 'critWeightLive') {
      updateCritWeight(parseInt(el.dataset.critIdx, 10), el.value);
      return;
    }
    // Points input live update
    if (el.classList.contains('gb-pts-input')) {
      livePointsUpdate(el);
      return;
    }
  }

  function _handleChange(e) {
    var el = e.target;
    if (el.dataset.action === 'assessSwitchCourse') {
      switchCourse(el.value);
      return;
    }
    if (el.dataset.actionChange === 'updateCalcMethod') {
      updateCalc(el.value);
      return;
    }
    if (el.dataset.actionChange === 'importDataFile') {
      importData(el);
      return;
    }
    if (el.dataset.actionChange === 'onRubricSelect') {
      onRubricSelect(el.value);
      return;
    }
    if (el.dataset.actionChange === 'autoSetDueDate') {
      autoSetDueDate();
      return;
    }
    if (el.dataset.actionChange === 'saveGradingScale') {
      saveGradingScale();
      return;
    }
    if (el.dataset.actionChange === 'toggleCategoryWeights') {
      toggleCategoryWeights(el.checked);
      return;
    }
    if (el.dataset.actionChange === 'moduleColor') {
      updateModuleColor(el.dataset.moduleid, el.value);
      return;
    }
    if (el.dataset.actionChange === 'tagCheckbox') {
      onTagChange(el, el.dataset.section);
      return;
    }
    if (el.dataset.actionChange === 'collabToggleStudent') {
      collabToggleStudent(el.dataset.sid, el.checked);
      return;
    }
  }

  function _handleBlur(e) {
    var el = e.target;
    if (el.dataset.actionBlur === 'moduleName') {
      updateModuleName(el.dataset.moduleid, el.value);
      return;
    }
    if (el.dataset.actionBlur === 'critName') {
      updateCritName(parseInt(el.dataset.critIdx, 10), el.value);
      return;
    }
    if (el.dataset.actionBlur === 'critLevel') {
      updateCritLevel(parseInt(el.dataset.crit, 10), parseInt(el.dataset.level, 10), el.value);
      return;
    }
    // T-UI-09 / T-UI-10 · rubric weight + per-level value overrides.
    if (el.dataset.actionBlur === 'critWeight') {
      updateCritWeight(parseInt(el.dataset.critIdx, 10), el.value);
      return;
    }
    if (el.dataset.actionBlur === 'critLevelValue') {
      updateCritLevelValue(parseInt(el.dataset.crit, 10), parseInt(el.dataset.level, 10), el.value);
      return;
    }
    // Points input commit on blur
    if (el.classList.contains('gb-pts-input')) {
      commitPointsScore(el);
      return;
    }
  }

  function _handleKeydown(e) {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      // Handle comment input Enter key
      if (e.key === 'Enter' && document.activeElement.id === 'comment-input') {
        e.preventDefault();
        submitComment();
      }
      // Handle points keyboard navigation
      if (document.activeElement.classList.contains('gb-pts-input')) {
        handlePointsKey(e, document.activeElement);
      }
      return;
    }
    if (!_kbFocusEl) return;
    var key = e.key;
    if (['1', '2', '3', '4'].includes(key)) {
      e.preventDefault();
      var val = parseInt(key, 10);
      if (_kbFocusEl.classList.contains('rsg-criterion-row')) {
        var lvl = _kbFocusEl.querySelector('.l' + val);
        if (lvl) lvl.click();
      }
      navigateKb('down');
      return;
    }
    if (key === '0' || key === 'Backspace' || key === 'Delete') {
      e.preventDefault();
      if (_kbFocusEl.classList.contains('rsg-criterion-row')) {
        var active = _kbFocusEl.querySelector('.rsg-level.active');
        if (active) active.click();
      }
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
      e.preventDefault();
      navigateKb(key.replace('Arrow', '').toLowerCase());
      return;
    }
    if (key === 'Escape') {
      kbFocusCell(null);
      return;
    }
  }

  /* ── Drag event handlers (delegated) ────────────────────── */
  function _handleDragStart(e) {
    // Collab drag must be checked FIRST — members are nested inside assess cards
    var collabDrag = e.target.closest('[data-collab-drag-sid]');
    if (collabDrag) {
      collabDragStart(e, collabDrag.dataset.collabDragSid, parseInt(collabDrag.dataset.collabDragGroup, 10));
      return;
    }
    var assessDrag = e.target.closest('[data-assess-drag]');
    if (assessDrag) {
      onAssessDragStart(e, assessDrag.dataset.assessDrag);
      return;
    }
    var moduleDrag = e.target.closest('[data-module-drag]');
    if (moduleDrag) {
      onModuleDragStart(e, moduleDrag.dataset.moduleDrag);
      return;
    }
  }
  function _handleDragEnd(e) {
    if (_dragAssessId) {
      onAssessDragEnd();
      return;
    }
    if (_dragModuleId) {
      onModuleDragEnd();
      return;
    }
    _dragSid = null;
    _dragFromGroup = null;
  }
  function _handleDragOver(e) {
    // Module drop zone
    var dropZone = e.target.closest('[data-mod-drop-zone]');
    if (dropZone && _dragModuleId) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      dropZone.classList.add('drag-over');
      return;
    }
    // Assess card merge (check BEFORE folder drop — cards are inside folders)
    var cardDrop = e.target.closest('[data-assess-card-drop]');
    if (cardDrop && _dragAssessId && !_dragModuleId) {
      var targetId = cardDrop.dataset.assessCardDrop;
      if (_dragAssessId === targetId) return;
      var cid = activeCourse;
      var assessments = getAssessments(cid);
      var draggedA = assessments.find(function (x) {
        return x.id === _dragAssessId;
      });
      var targetA = assessments.find(function (x) {
        return x.id === targetId;
      });
      if (!draggedA || draggedA.moduleId || !targetA || targetA.moduleId) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (_mergeTargetId === targetId) return;
      _clearMergeState();
      _mergeTargetId = targetId;
      _mergeHoverTimer = setTimeout(function () {
        _mergeAnimating = true;
        var el = document.getElementById('ac-' + targetId);
        if (el) el.classList.add('merge-target');
      }, 300);
      return;
    }
    // Folder drop
    var folderDrop = e.target.closest('[data-folder-drop]');
    if (folderDrop && !_dragModuleId && _dragAssessId) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!folderDrop.classList.contains('drag-over')) folderDrop.classList.add('drag-over');
      return;
    }
    // Collab group drop
    var collabDrop = e.target.closest('[data-collab-drop]');
    if (collabDrop) {
      e.preventDefault();
      collabDrop.classList.add('drag-over');
      return;
    }
  }
  function _handleDragLeave(e) {
    var dropZone = e.target.closest('[data-mod-drop-zone]');
    if (dropZone) {
      dropZone.classList.remove('drag-over');
      return;
    }
    // Card leave (check before folder — cards are inside folders)
    var cardDrop = e.target.closest('[data-assess-card-drop]');
    if (cardDrop) {
      var el = document.getElementById('ac-' + cardDrop.dataset.assessCardDrop);
      if (el && el.contains(e.relatedTarget)) return;
      if (_mergeTargetId === cardDrop.dataset.assessCardDrop) _clearMergeState();
      return;
    }
    var folderDrop = e.target.closest('[data-folder-drop]');
    if (folderDrop && !folderDrop.contains(e.relatedTarget)) {
      folderDrop.classList.remove('drag-over');
      return;
    }
    var collabDrop = e.target.closest('[data-collab-drop]');
    if (collabDrop) {
      collabDrop.classList.remove('drag-over');
      return;
    }
  }
  function _handleDrop(e) {
    // Module drop zone
    var dropZone = e.target.closest('[data-mod-drop-zone]');
    if (dropZone && _dragModuleId) {
      onModuleDropZoneDrop(e, parseInt(dropZone.dataset.dropIndex, 10));
      return;
    }
    // Assess card merge drop (check before folder — cards are inside folders)
    var cardDrop = e.target.closest('[data-assess-card-drop]');
    if (
      cardDrop &&
      _mergeAnimating &&
      _mergeTargetId === cardDrop.dataset.assessCardDrop &&
      _dragAssessId &&
      _dragAssessId !== cardDrop.dataset.assessCardDrop
    ) {
      e.preventDefault();
      e.stopPropagation();
      mergeToNewModule(_dragAssessId, cardDrop.dataset.assessCardDrop);
      _clearMergeState();
      _dragAssessId = null;
      return;
    }
    // Folder drop
    var folderDrop = e.target.closest('[data-folder-drop]');
    if (folderDrop && _dragAssessId) {
      folderDrop.classList.remove('drag-over');
      onFolderDrop(e, folderDrop.dataset.folderDrop);
      return;
    }
    // Collab drop
    var collabDropEl = e.target.closest('[data-collab-drop]');
    if (collabDropEl) {
      collabDrop(e, parseInt(collabDropEl.dataset.collabDrop, 10));
      return;
    }
  }

  /* ── Mouseenter/mouseleave for rubric tooltips ──────────── */
  function _handleMouseOver(e) {
    var lvl = e.target.closest('.rsg-level[data-action="selectRubricScore"]');
    if (lvl) {
      var aid = lvl.dataset.aid;
      var critid = lvl.dataset.critid;
      var level = parseInt(lvl.dataset.level, 10);
      if (aid && critid && level) showCritTooltip(e, aid, critid, level);
    }
  }
  function _handleMouseOut(e) {
    var lvl = e.target.closest('.rsg-level[data-action="selectRubricScore"]');
    if (lvl) resetDescriptorBar();
  }

  /* ── init / destroy ─────────────────────────────────────── */
  function init(params) {
    // Reset all state
    activeCourse = (params && params.course) || getActiveCourse();
    setActiveCourse(activeCourse);
    openAssessIds = new Set();
    focusStudentParam = (params && params.student) || null;
    focusStudentId = focusStudentParam || null;
    _allExpanded = !(params && params.open && focusStudentParam);
    _collapsedIds = new Set();
    assessFilterType = 'all';
    assessSearch = '';
    showUngraded = false;
    rubricViewStates = {};
    _rubricsPanelOpen = false;
    _advancedPanelOpen = false;
    _showingNewForm = false;
    _editingAssessId = null;
    collapsedModules = {};
    _dragAssessId = null;
    _dragModuleId = null;
    _mergeTargetId = null;
    _mergeHoverTimer = null;
    _mergeAnimating = false;
    AC.configure(activeCourse);
    _resetCollabState();
    _editingRubric = null;
    _rubricDirty = false;
    _rubricAutoTags = [];
    _commentPopoverState = null;
    _kbFocusEl = null;
    _statusDebounce = {};
    _searchTimer = null;

    if (params && params.open) {
      openAssessIds = new Set([params.open]);
    }

    // Show sidebar
    document.getElementById('sidebar-mount').style.display = '';
    document.getElementById('page-layout').classList.remove('sidebar-hidden');

    // Set up sidebar with student list
    window.toggleFocusStudent = toggleFocusStudent;
    document.getElementById('sidebar-mount').innerHTML = renderSidebar(
      activeCourse,
      focusStudentId,
      'toggleFocusStudent',
    );
    initSidebarToggle();

    // Expose switchCourse globally for dock
    window._pageSwitchCourse = switchCourse;

    // Add delegated listeners
    _addDocListener('click', _handleClick);
    _addDocListener('input', _handleInput);
    _addDocListener('change', _handleChange);
    _addDocListener('blur', _handleBlur, true);
    _addDocListener('keydown', _handleKeydown);
    _addDocListener('dragstart', _handleDragStart);
    _addDocListener('dragend', _handleDragEnd);
    _addDocListener('dragover', _handleDragOver);
    _addDocListener('dragleave', _handleDragLeave);
    _addDocListener('drop', _handleDrop);
    _addDocListener('mouseover', _handleMouseOver);
    _addDocListener('mouseout', _handleMouseOut);

    render();

    // Auto-scroll to open card if arriving via ?open= param
    if (params && params.open) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          var openCard = document.querySelector('.assess-card.open');
          if (openCard) openCard.scrollIntoView({ block: 'center' });
        });
      });
    }

    // Auto-open new form if ?new=1
    if (params && params.new === '1') {
      setTimeout(function () {
        showNewForm();
      }, 100);
    }
  }

  function destroy() {
    // Remove all tracked listeners
    _listeners.forEach(function (l) {
      document.removeEventListener(l.type, l.handler, l.options);
    });
    _listeners = [];

    // Clear timers
    if (_searchTimer) clearTimeout(_searchTimer);
    if (_mergeHoverTimer) clearTimeout(_mergeHoverTimer);
    Object.keys(_statusDebounce).forEach(function (k) {
      delete _statusDebounce[k];
    });

    // Clean up descriptor bar (appended to body)
    var bar = document.getElementById('rsg-descriptor-bar');
    if (bar) bar.remove();

    // Clean up rubric modal (appended to body)
    var modal = document.getElementById('rubric-modal');
    if (modal) modal.remove();

    // Clean up comment popover (appended to body)
    var overlay = document.getElementById('comment-popover-overlay');
    if (overlay) overlay.remove();

    // Remove globals
    delete window._pageSwitchCourse;
    delete window.toggleFocusStudent;
  }

  /* ── Public API ─────────────────────────────────────────── */
  return {
    init: init,
    destroy: destroy,
    render: render,
    switchCourse: switchCourse,
    toggleFocusStudent: toggleFocusStudent,
  };
})();
