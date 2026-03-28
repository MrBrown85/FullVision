/* ── page-dashboard.js — Dashboard page module ───────────── */
window.PageDashboard = (function() {
  'use strict';

  /* ── Listener tracking for cleanup ──────────────────────── */
  var _listeners = [];
  function _addDocListener(type, handler, options) {
    document.addEventListener(type, handler, options);
    _listeners.push({ type: type, handler: handler, options: options });
  }

  /* ── Color palette for subjects/sections ─────────────────── */
  var CM_COLORS = [
    '#dc2626', '#ea580c', '#d97706', '#ca8a04', '#16a34a',
    '#059669', '#0891b2', '#2563eb', '#7c3aed', '#c026d3',
    '#db2777', '#78716c', '#475569', '#1e3a5f', '#334155'
  ];

  /* ── State variables ────────────────────────────────────── */
  var activeCourse;
  var showFlaggedOnly = false;
  var sortMode = 'last-asc';
  var searchQuery = '';
  var _dashSearchTimer = null;

  // Class Manager state
  var classManagerOpen = false;
  var cmSelectedCourse = null;
  var cmMode = 'edit';

  // Curriculum Wizard state
  var cwStep = 1;
  var cwSelectedGrade = null;
  var cwSelectedSubject = null;
  var cwSelectedTags = [];
  var cwCurriculumLoaded = false;
  var cwLoadError = false;

  // Class Manager student editing
  var cmEditingStudentId = null;

  // Bulk edit
  var cmBulkMode = false;
  var cmBulkSelected = new Set();

  // Import preview
  var cmPendingImport = null;

  // Relink
  var cmRelinkCid = null;
  var cmRelinkStep = 0;

  // Standard folder collapse state
  var _cmCollapsedStdFolders = {};
  var _cmOpenStdCards = {};

  // Render a compact standard card (mirrors .assess-card pattern)
  function _cmRenderStdCard(sec, lm, compGroups) {
    var tag = sec.tags[0] || {};
    var sub = (lm.subjects||[]).find(function(s) { return s.id === sec.subject; });
    var subName = sub ? sub.name : '';
    var subColor = sub ? sub.color : 'var(--text-3)';
    var isOpen = _cmOpenStdCards[sec.id];
    var html = '<div class="cm-std-card' + (isOpen ? ' open' : '') + '" draggable="true" data-std-drag="' + sec.id + '" id="cm-std-' + sec.id + '">' +
      '<div class="cm-std-header" data-action="cmToggleStdCard" data-secid="' + sec.id + '">' +
        '<div class="cm-std-color-bar" style="background:' + sec.color + '"></div>' +
        '<span class="cm-std-tag">' + esc(tag.id) + '</span>' +
        '<span class="cm-std-label">' + esc(tag.label || sec.shortName || sec.name) + '</span>' +
        '<span class="cm-std-subject"><span class="cm-std-subject-dot" style="background:' + subColor + '"></span>' + esc(subName) + '</span>' +
        '<span class="cm-std-chevron">\u25B8</span>' +
      '</div>' +
      '<div class="cm-std-body">' +
        '<div class="cm-std-edit-row-wide">' +
          '<div style="flex:1"><label class="cm-label">Standard Name</label>' +
            '<input class="cm-input" value="' + esc(sec.name) + '" style="font-weight:600;font-size:0.82rem" data-stop-prop="true" data-action-blur="cmStdName" data-secid="' + sec.id + '"></div>' +
          '<div style="min-width:100px"><label class="cm-label">Subject</label>' +
            '<select class="cm-input" style="font-size:0.78rem" data-stop-prop="true" data-action-change="cmStdSubject" data-secid="' + sec.id + '">' +
              (lm.subjects||[]).map(function(s) { return '<option value="' + s.id + '"' + (s.id===sec.subject?' selected':'') + '>' + esc(s.name) + '</option>'; }).join('') +
            '</select></div>' +
          (compGroups.length > 0 ? '<div style="min-width:90px"><label class="cm-label">Group</label>' +
            '<select class="cm-input" style="font-size:0.78rem" data-stop-prop="true" data-action-change="cmStdGroup" data-secid="' + sec.id + '">' +
              '<option value="">None</option>' +
              compGroups.map(function(g) { return '<option value="' + g.id + '"' + (sec.groupId===g.id?' selected':'') + '>' + esc(g.name) + '</option>'; }).join('') +
            '</select></div>' : '') +
          '<div><label class="cm-label">Color</label>' +
            '<div style="background:' + sec.color + ';width:32px;height:32px;border-radius:8px;margin-top:2px;position:relative">' +
              '<div class="cm-color-swatch-selected" style="background:' + sec.color + '" data-action="cmToggleColorPalette" data-target="section" data-secid="' + sec.id + '"></div>' +
              '<div class="cm-color-palette" id="cm-palette-section-' + sec.id + '"></div>' +
            '</div></div>' +
          '<button class="cm-delete-mini" data-action="cmDeleteStd" data-stop-prop="true" data-secid="' + sec.id + '" title="Delete standard" style="width:32px;height:32px;align-self:flex-end">\u2715</button>' +
        '</div>' +
        '<div style="display:flex;gap:12px;align-items:flex-end;margin-bottom:8px">' +
          '<div style="flex:0 0 120px"><label class="cm-label">Tag Code</label>' +
            '<input class="cm-input" value="' + esc(tag.id) + '" placeholder="e.g. RD1" maxlength="10" style="padding:5px 8px;font-size:0.82rem;font-weight:600;font-family:monospace;text-transform:uppercase" data-stop-prop="true" data-action-blur="cmStdCode" data-secid="' + sec.id + '"></div>' +
          '<div style="flex:1"><label class="cm-label">Short Label</label>' +
            '<input class="cm-input" value="' + esc(tag.label) + '" placeholder="Short label" style="padding:5px 8px;font-size:0.82rem;font-weight:500" data-action-blur="cmStdLabel" data-secid="' + sec.id + '"></div>' +
        '</div>' +
        '<label class="cm-label">I can\u2026 Statement</label>' +
        '<textarea class="cm-textarea" placeholder="I can\u2026 statement" style="min-height:34px;padding:5px 8px;font-size:0.78rem" data-action-blur="cmStdText" data-secid="' + sec.id + '">' + esc(tag.text||'') + '</textarea>' +
      '</div></div>';
    return html;
  }

  function cmToggleStdCard(secId) {
    _cmOpenStdCards[secId] = !_cmOpenStdCards[secId];
    var card = document.getElementById('cm-std-' + secId);
    if (card) card.classList.toggle('open', _cmOpenStdCards[secId]);
  }

  function cmToggleStdFolder(uid) {
    _cmCollapsedStdFolders[uid] = !_cmCollapsedStdFolders[uid];
    var folder = document.querySelector('.mod-folder[data-module-id="' + uid + '"]');
    if (folder) folder.classList.toggle('open', !_cmCollapsedStdFolders[uid]);
  }

  // Drag-and-drop for standards between group folders
  var _cmDragStdId = null;
  var _cmMergeTargetId = null;
  var _cmMergeHoverTimer = null;
  var _cmMergeAnimating = false;
  var CM_GROUP_COLORS = ['#6366f1','#06b6d4','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#64748b'];

  function _cmClearMerge() {
    if (_cmMergeHoverTimer) { clearTimeout(_cmMergeHoverTimer); _cmMergeHoverTimer = null; }
    if (_cmMergeTargetId) { var el = document.getElementById('cm-std-' + _cmMergeTargetId); if (el) el.classList.remove('merge-target'); }
    _cmMergeTargetId = null; _cmMergeAnimating = false;
  }

  function _cmMergeToNewGroup(draggedId, targetId) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    if (!map.competencyGroups) map.competencyGroups = [];
    var idx = map.competencyGroups.length;
    var grp = {
      id: 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: 'Group ' + (idx + 1),
      color: CM_GROUP_COLORS[idx % CM_GROUP_COLORS.length],
      sortOrder: idx
    };
    map.competencyGroups.push(grp);
    [draggedId, targetId].forEach(function(sid) {
      var sec = (map.sections || []).find(function(s) { return s.id === sid; });
      if (sec) sec.groupId = grp.id;
    });
    saveLearningMap(cmSelectedCourse, map);
    renderClassManager();
    setTimeout(function() {
      var input = document.querySelector('.mod-folder[data-module-id="' + grp.id + '"] .mod-folder-name-input');
      if (input) { input.focus(); input.select(); }
    }, 50);
  }

  function _initCmStdDrag() {
    _addDocListener('dragstart', function(e) {
      var card = e.target.closest && e.target.closest('.cm-std-card[data-std-drag]');
      if (!card) return;
      _cmDragStdId = card.dataset.stdDrag;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', _cmDragStdId);
    });
    _addDocListener('dragover', function(e) {
      if (!_cmDragStdId) return;
      var targetCard = e.target.closest && e.target.closest('.cm-std-card[data-std-drag]');
      if (targetCard) {
        var targetId = targetCard.dataset.stdDrag;
        if (targetId !== _cmDragStdId) {
          var map = cmSelectedCourse ? getLearningMap(cmSelectedCourse) : null;
          var targetSec = map && (map.sections || []).find(function(s) { return s.id === targetId; });
          if (targetSec && !targetSec.groupId) {
            e.preventDefault(); e.dataTransfer.dropEffect = 'move';
            if (_cmMergeTargetId === targetId) return;
            _cmClearMerge(); _cmMergeTargetId = targetId;
            _cmMergeHoverTimer = setTimeout(function() {
              _cmMergeAnimating = true;
              var el = document.getElementById('cm-std-' + targetId);
              if (el) el.classList.add('merge-target');
            }, 300);
            return;
          }
        }
      } else {
        if (_cmMergeTargetId) _cmClearMerge();
      }
      var folder = e.target.closest && e.target.closest('.mod-folder[data-folder-drop]');
      if (!folder) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.mod-folder.drag-over').forEach(function(f) { f.classList.remove('drag-over'); });
      folder.classList.add('drag-over');
      if (!folder.classList.contains('open')) folder.classList.add('open');
    });
    _addDocListener('dragleave', function(e) {
      if (!_cmDragStdId) return;
      var targetCard = e.target.closest && e.target.closest('.cm-std-card[data-std-drag]');
      if (targetCard && !targetCard.contains(e.relatedTarget)) {
        if (_cmMergeTargetId === targetCard.dataset.stdDrag) _cmClearMerge();
        return;
      }
      var folder = e.target.closest && e.target.closest('.mod-folder[data-folder-drop]');
      if (folder && !folder.contains(e.relatedTarget)) folder.classList.remove('drag-over');
    });
    _addDocListener('drop', function(e) {
      if (!_cmDragStdId) return;
      var targetCard = e.target.closest && e.target.closest('.cm-std-card[data-std-drag]');
      if (targetCard && _cmMergeAnimating && _cmMergeTargetId === targetCard.dataset.stdDrag) {
        e.preventDefault(); e.stopPropagation();
        _cmMergeToNewGroup(_cmDragStdId, targetCard.dataset.stdDrag);
        _cmClearMerge(); _cmDragStdId = null;
        document.querySelectorAll('.cm-std-card.dragging').forEach(function(c) { c.classList.remove('dragging'); });
        return;
      }
      var folder = e.target.closest && e.target.closest('.mod-folder[data-folder-drop]');
      if (!folder) return;
      e.preventDefault();
      var targetGroupId = folder.dataset.folderDrop;
      if (targetGroupId === '__none__') targetGroupId = '';
      if (cmSelectedCourse) {
        var map = ensureCustomLearningMap(cmSelectedCourse);
        var sec = (map.sections || []).find(function(s) { return s.id === _cmDragStdId; });
        if (sec) {
          if (targetGroupId) sec.groupId = targetGroupId;
          else delete sec.groupId;
          saveLearningMap(cmSelectedCourse, map);
          renderClassManager();
        }
      }
      _cmDragStdId = null;
      document.querySelectorAll('.mod-folder.drag-over').forEach(function(f) { f.classList.remove('drag-over'); });
      document.querySelectorAll('.cm-std-card.dragging').forEach(function(c) { c.classList.remove('dragging'); });
    });
    _addDocListener('dragend', function() {
      _cmDragStdId = null; _cmClearMerge();
      document.querySelectorAll('.mod-folder.drag-over').forEach(function(f) { f.classList.remove('drag-over'); });
      document.querySelectorAll('.cm-std-card.dragging').forEach(function(c) { c.classList.remove('dragging'); });
    });
  }

  // Step 2 stash
  var cwStep2Name = '', cwStep2Grade = '', cwStep2Desc = '';
  var cwStep2Grading = 'proficiency', cwStep2Calc = 'mostRecent', cwStep2Decay = '65';

  var trendIcon = {
    up:   '<span style="color:var(--score-3);font-size:0.85rem">&#x2191;</span>',
    down: '<span style="color:var(--score-1);font-size:0.85rem">&#x2193;</span>',
    flat: '<span style="color:var(--text-3);font-size:0.85rem">&#x2192;</span>'
  };

  /* ── Search ─────────────────────────────────────────────── */
  function dashSearchInput(el) {
    var val = el.value.toLowerCase();
    var pos = el.selectionStart;
    clearTimeout(_dashSearchTimer);
    _dashSearchTimer = setTimeout(function() {
      searchQuery = val;
      render();
      requestAnimationFrame(function() {
        var inp = document.querySelector('.dash-search-input');
        if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
      });
    }, 150);
  }

  /* ── switchCourse ───────────────────────────────────────── */
  async function switchCourse(cid) {
    activeCourse = cid;
    setActiveCourse(cid);
    // Reset class manager state for new course
    cmSelectedCourse = cid;
    cmEditingStudentId = null;
    cmBulkMode = false;
    cmBulkSelected = new Set();
    cmPendingImport = null;
    cmRelinkCid = null;
    cmRelinkStep = 0;
    await initData(cid);
    render();
  }

  /* ── Toolbar ────────────────────────────────────────────── */
  function renderDashToolbar(cid, students, flagCount) {
    var courseOptions = Object.keys(COURSES).filter(function(cid) { return !getCourseConfig(cid).archived; }).map(function(cid) {
      return '<option value="' + cid + '"' + (cid === activeCourse ? ' selected' : '') + '>' + esc(COURSES[cid].name) + '</option>';
    }).join('');
    return '<div class="dash-toolbar">' +
      '<select class="dash-course-select" data-action="dashSwitchCourse" aria-label="Select course">' + courseOptions + '</select>' +
      '<button class="dash-add-btn" data-action="openClassManager">Class Management</button>' +
      '<div class="dash-search-wrap">' +
        '<span class="search-icon" aria-hidden="true">\uD83D\uDD0D</span>' +
        '<input class="dash-search-input" type="text" placeholder="Search students\u2026" value="' + esc(searchQuery) + '" data-action-input="dashSearch" aria-label="Search students">' +
      '</div>' +
      '<select class="dash-sort-select" data-action="dashSort" aria-label="Sort students">' +
        '<option value="last-asc"' + (sortMode === 'last-asc' ? ' selected' : '') + '>Last Name A\u2192Z</option>' +
        '<option value="last-desc"' + (sortMode === 'last-desc' ? ' selected' : '') + '>Last Name Z\u2192A</option>' +
        '<option value="first-asc"' + (sortMode === 'first-asc' ? ' selected' : '') + '>First Name A\u2192Z</option>' +
        '<option value="first-desc"' + (sortMode === 'first-desc' ? ' selected' : '') + '>First Name Z\u2192A</option>' +
        '<option value="overall-desc"' + (sortMode === 'overall-desc' ? ' selected' : '') + '>Overall High\u2192Low</option>' +
        '<option value="overall-asc"' + (sortMode === 'overall-asc' ? ' selected' : '') + '>Overall Low\u2192High</option>' +
        '<option value="flagged"' + (sortMode === 'flagged' ? ' selected' : '') + '>Flagged First</option>' +
      '</select>' +
      '<button class="dash-filter-chip' + (showFlaggedOnly ? ' active' : '') + '" data-action="toggleFlaggedFilter" aria-pressed="' + showFlaggedOnly + '" aria-label="Show flagged students only' + (flagCount > 0 ? ', ' + flagCount + ' flagged' : '') + '">\u2691 Flagged' + (flagCount > 0 ? ' (' + flagCount + ')' : '') + '</button>' +
      '<div class="dash-toolbar-spacer"></div>' +
      '<span class="dash-toolbar-label">' + students.length + ' student' + (students.length !== 1 ? 's' : '') + '</span>' +
    '</div>';
  }

  /* ── Overview Panel ─────────────────────────────────────── */
  function renderOverviewPanel(cid, sections, allStudents, assessments, classAvg, classR, tagCoveragePct, sectionClassAvgs, tagsWithEvidence, allTags, tagCoverageMap, assessedCCs, ccCounts, ccAssessments, recentObsCount, flagCount, actionItems) {
    var html = '';

    html += '<div class="dash-section">';
    html += '<div class="dash-overview">';

    // COLUMN 1: Class Distribution + Curricular Competencies
    html += '<div class="dash-overview-section">';

    // Class Distribution
    var distrib = { 1: 0, 2: 0, 3: 0, 4: 0 };
    var distribStudents = { 1: [], 2: [], 3: [], 4: [] };
    allStudents.forEach(function(s) {
      var p = Math.round(getOverallProficiency(cid, s.id));
      if (p >= 1 && p <= 4) {
        distrib[p]++;
        distribStudents[p].push(displayName(s));
      }
    });
    var totalWithProf = distrib[1] + distrib[2] + distrib[3] + distrib[4];

    html += '<div class="dash-section-title">Class Distribution</div>';
    if (totalWithProf > 0) {
      html += '<div style="display:flex;height:28px;gap:2px">';
      var distribData = [
        { level: 4, label: 'Extending', color: 'var(--score-4)', tint: 'var(--score-4-bg)' },
        { level: 3, label: 'Proficient', color: 'var(--score-3)', tint: 'var(--score-3-bg)' },
        { level: 2, label: 'Developing', color: 'var(--score-2)', tint: 'var(--score-2-bg)' },
        { level: 1, label: 'Emerging', color: 'var(--score-1)', tint: 'var(--score-1-bg)' }
      ];
      distribData.forEach(function(d) {
        var pct = (distrib[d.level] / totalWithProf) * 100;
        if (pct > 0) {
          var names = distribStudents[d.level].sort().map(function(n) { return '<div class="dist-tip-name">' + esc(n) + '</div>'; }).join('');
          html += '<div class="dist-seg" style="flex:' + distrib[d.level] + ';background:' + d.tint + ';display:flex;align-items:center;justify-content:center;min-width:' + (pct > 8 ? '0' : '28px') + ';transition:flex 0.3s var(--ease-out)">' +
            '<span style="font-family:var(--font-base);font-size:' + (pct > 15 ? '0.78rem' : '0.65rem') + ';font-weight:700;color:' + d.color + '">' + distrib[d.level] + '</span>' +
            '<div class="dist-tip">' +
              '<div class="dist-tip-title">' + d.label + '</div>' +
              names +
            '</div>' +
          '</div>';
        }
      });
      html += '</div>';
      html += '<div style="display:flex;gap:12px;margin-top:6px;justify-content:center">';
      distribData.forEach(function(d) {
        if (distrib[d.level] > 0) {
          html += '<div style="display:flex;align-items:center;gap:4px">' +
            '<div style="width:8px;height:8px;border-radius:2px;background:' + d.color + '"></div>' +
            '<span style="font-family:var(--font-base);font-size:0.65rem;color:var(--text-2)">' + d.label + '</span>' +
          '</div>';
        }
      });
      html += '</div>';
    } else {
      html += '<div style="height:28px;border-radius:8px;background:var(--overlay-hover);display:flex;align-items:center;justify-content:center">' +
        '<span style="font-family:var(--font-base);font-size:0.72rem;color:var(--text-3)">No data yet</span>' +
      '</div>';
    }

    html += '<div style="margin-top:14px"><div class="dash-section-title">Curricular Competencies' +
        '<a href="#/gradebook?course=' + cid + '">View Gradebook \u2192</a>' +
      '</div></div>';

    // Quick stats row
    html += '<div class="dash-quick-stats">' +
      '<div class="dash-mini-stat">' +
        '<div class="dash-mini-stat-val" style="color:' + (classAvg > 0 ? PROF_COLORS[classR] : 'var(--text-3)') + '">' + (classAvg > 0 ? classAvg.toFixed(1) : '\u2014') + '</div>' +
        '<div class="dash-mini-stat-label">Class Avg</div>' +
      '</div>' +
      '<div class="dash-mini-stat">' +
        '<div class="dash-mini-stat-val" style="color:' + (tagCoveragePct >= 75 ? 'var(--score-3)' : tagCoveragePct >= 50 ? 'var(--score-2)' : 'var(--score-1)') + '">' + tagCoveragePct + '%</div>' +
        '<div class="dash-mini-stat-label">Standards Covered</div>' +
      '</div>' +
      '<div class="dash-mini-stat">' +
        '<div class="dash-mini-stat-val">' + assessments.length + '</div>' +
        '<div class="dash-mini-stat-label">Assessments</div>' +
      '</div>' +
    '</div>';

    // Section bars
    sectionClassAvgs.forEach(function(item) {
      var sec = item.section, avg = item.avg;
      var r = Math.round(avg);
      var pct = avg > 0 ? (avg / 4 * 100) : 0;
      var color = avg > 0 ? PROF_COLORS[r] : 'var(--text-3)';
      var rawColor = avg > 0 ? (r === 1 ? 'var(--score-1)' : r === 2 ? 'var(--score-2)' : r === 3 ? 'var(--score-3)' : r === 4 ? 'var(--score-4)' : 'var(--text-3)') : 'var(--divider-subtle)';
      html += '<div class="dash-outcome-row">' +
        '<span class="dash-outcome-label" style="color:' + sec.color + '">' + esc(sec.shortName || sec.name) + '</span>' +
        '<div class="dash-outcome-bar-track">' +
          '<div class="dash-outcome-bar-fill" style="width:' + pct + '%;background:' + rawColor + '"></div>' +
        '</div>' +
        '<span class="dash-outcome-val" style="color:' + color + '">' + (avg > 0 ? avg.toFixed(1) : '\u2014') + '</span>' +
      '</div>';
    });

    // Tag coverage pips
    html += '<div style="margin-top:10px">' +
      '<div style="font-family:\'SF Mono\', ui-monospace, \'Menlo\', monospace;font-size:0.52rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-3);margin-bottom:4px">' + tagsWithEvidence + ' of ' + allTags.length + ' standards assessed</div>' +
      '<div class="dash-tag-grid">';
    sections.forEach(function(sec) {
      sec.tags.forEach(function(tag) {
        var hasEv = tagCoverageMap[tag.id];
        var bg = hasEv ? sec.color : 'var(--divider-subtle)';
        html += '<div class="dash-tag-pip" title="' + esc(tag.text || tag.label) + (hasEv ? '' : ' \u2014 not yet assessed') + '" style="background:' + bg + '"></div>';
      });
    });
    html += '</div></div>';
    html += '</div>';

    // COLUMN 2: Observations
    html += '<div class="dash-overview-section">';

    html += '<div style="margin-top:0">' +
      '<div class="dash-section-title">Observations' +
        '<a href="#/observations">Record \u2192</a>' +
      '</div>' +
      '<div class="dash-quick-stats">' +
        '<div class="dash-mini-stat">' +
          '<div class="dash-mini-stat-val" style="color:var(--active)">' + recentObsCount + '</div>' +
          '<div class="dash-mini-stat-label">This Week</div>' +
        '</div>' +
        '<div class="dash-mini-stat">' +
          '<div class="dash-mini-stat-val" style="color:' + (flagCount > 0 ? 'var(--priority)' : 'var(--text-3)') + '">' + flagCount + '</div>' +
          '<div class="dash-mini-stat-label">Flagged</div>' +
        '</div>' +
        '<div class="dash-mini-stat">' +
          '<div class="dash-mini-stat-val">' + allStudents.length + '</div>' +
          '<div class="dash-mini-stat-label">Students</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    // Birthdays in center column
    var upcomingBdays = getUpcomingBirthdays(cid);
    if (upcomingBdays.length > 0) {
      html += '<div style="margin-top:14px">' +
        '<div class="dash-section-title">Upcoming Birthdays</div>';
      upcomingBdays.forEach(function(b) {
        var dob = new Date(b.student.dateOfBirth);
        var monthDay = dob.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
        var countdown = b.daysUntil === 0 ? '<span style="color:var(--score-3);font-weight:600">Today!</span>'
          : b.daysUntil === 1 ? '<span style="color:var(--score-2);font-weight:600">Tomorrow</span>'
          : '<span style="color:var(--text-3)">in ' + b.daysUntil + ' days</span>';
        html += '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:0.82rem">' +
          '<div class="bday-avatar">' + initials(b.student) + '</div>' +
          '<span style="font-weight:500;color:var(--text)">' + esc(displayName(b.student)) + '</span>' +
          '<span style="font-size:0.75rem;color:var(--text-3)">' + monthDay + '</span>' +
          '<span style="margin-left:auto;font-size:0.75rem">' + countdown + '</span>' +
        '</div>';
      });
      html += '</div>';
    }

    html += '</div>';

    // COLUMN 3: Core Competencies + Action Items
    html += '<div class="dash-overview-section">' +
      '<div class="dash-section-title">Core Competencies</div>';

    html += '<div class="dash-cc-grid">';
    CORE_COMPETENCIES.forEach(function(cc) {
      var assessed = assessedCCs.has(cc.id);
      var count = ccCounts[cc.id] || 0;
      var aNames = (ccAssessments[cc.id] || []).map(function(n) { return '<div class="dist-tip-name">' + esc(n) + '</div>'; }).join('');
      html += '<div class="dash-cc-pill" style="' + (!assessed ? 'opacity:0.4' : '') + '">' +
        '<div class="dash-cc-dot" style="background:' + (assessed ? cc.color : 'var(--border)') + '"></div>' +
        esc(cc.label) +
        (count > 0 ? '<span class="dash-cc-count">' + count + '</span>' : '') +
        (count > 0 ? '<div class="dist-tip"><div class="dist-tip-title">' + esc(cc.label) + '</div>' + aNames + '</div>' : '') +
      '</div>';
    });
    html += '</div>';

    html += '<div style="margin-top:14px"><div class="dash-section-title">Next Steps</div>';

    if (actionItems.length === 0) {
      html += '<div class="dash-action-item"><span class="dash-action-dot" style="background:var(--score-3)"></span><span class="dash-action-text" style="color:var(--score-3)">Looking good! All standards covered, all competencies tagged.</span></div>';
    } else {
      html += '<div class="dash-action-list">';
      actionItems.forEach(function(item) {
        html += '<div class="dash-action-item">' +
          '<span class="dash-action-dot"></span>' +
          '<span class="dash-action-text">' + esc(item.text) + '</span>' +
          (item.link ? '<a class="dash-action-link" href="' + item.link + '">' + esc(item.linkText) + ' &rarr;</a>' : '') +
        '</div>';
      });
      html += '</div>';
    }

    html += '</div>';

    html += '</div>'; // close dash-overview

    return html;
  }

  /* ── Birthday Widget ────────────────────────────────────── */
  function renderBirthdayWidget(cid) {
    var upcomingBdays = getUpcomingBirthdays(cid);
    if (upcomingBdays.length === 0) return '';
    var html = '<div class="dash-birthday-box">' +
      '<div class="dash-section-title">Upcoming Birthdays</div>';
    upcomingBdays.forEach(function(b) {
      var dob = new Date(b.student.dateOfBirth);
      var monthDay = dob.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      var countdown = b.daysUntil === 0 ? '<span class="bday-today">Today!</span>'
        : b.daysUntil === 1 ? '<span class="bday-soon">Tomorrow</span>'
        : '<span class="bday-days">in ' + b.daysUntil + ' days</span>';
      html += '<div class="bday-row">' +
        '<div class="bday-avatar">' + initials(b.student) + '</div>' +
        '<div class="bday-info">' +
          '<div class="bday-name">' + esc(displayName(b.student)) + '</div>' +
          '<div class="bday-date">' + monthDay + '</div>' +
        '</div>' +
        '<div class="bday-countdown">' + countdown + '</div>' +
      '</div>';
    });
    html += '</div>';
    return html;
  }

  /* ── Student Cards ──────────────────────────────────────── */
  function renderStudentCards(cid, students, allStudents, sections, assessments, allScores, flags) {
    var html = '<div class="dash-section">';
    if (students.length === 0 && allStudents.length === 0) {
      html += '<div class="dash-empty">' +
        '<div class="dash-empty-icon">\uD83D\uDC69\u200D\uD83C\uDFEB</div>' +
        '<div class="dash-empty-title">No students yet</div>' +
        '<div class="dash-empty-text">Add your first student or import a class roster to get started.</div>' +
      '</div>';
    } else if (students.length === 0) {
      html += '<div class="dash-empty">' +
        '<div class="dash-empty-icon">\uD83D\uDD0D</div>' +
        '<div class="dash-empty-title">No matches</div>' +
        '<div class="dash-empty-text">Try adjusting your search or filters.</div>' +
      '</div>';
    } else {
      html += '<div class="dash-grid">';
      students.forEach(function(st) {
        var overall = getOverallProficiency(cid, st.id);
        var op = Math.round(overall);
        var flagged = isStudentFlagged(cid, st.id);
        var pct = getCompletionPct(cid, st.id);

        // Missing work count
        var missingCount = assessments.filter(function(a) {
          if (!a.dueDate || new Date(a.dueDate) >= new Date()) return false;
          var sc = allScores[st.id] || [];
          return !sc.some(function(x) { return x.assessmentId === a.id && x.score > 0; });
        }).length;

        // Overall trend
        var allSc = (allScores[st.id] || []).filter(function(sc) { return sc.type === 'summative' && sc.score > 0; });
        var trend = 'flat';
        if (allSc.length >= 4) {
          allSc.sort(function(a, b) { return (a.date || '').localeCompare(b.date || ''); });
          var mid = Math.floor(allSc.length / 2);
          var earlyAvg = allSc.slice(0, mid).reduce(function(a, b) { return a + b.score; }, 0) / mid;
          var lateAvg = allSc.slice(mid).reduce(function(a, b) { return a + b.score; }, 0) / (allSc.length - mid);
          if (lateAvg > earlyAvg + 0.2) trend = 'up';
          else if (lateAvg < earlyAvg - 0.2) trend = 'down';
        }

        // Last observation
        var obs = getStudentQuickObs(cid, st.id);
        var lastObs = obs.length > 0 ? obs[0] : null;
        var obsText = '';
        if (lastObs) {
          var snippet = lastObs.text.length > 45 ? lastObs.text.slice(0, 45) + '\u2026' : lastObs.text;
          obsText = '\uD83D\uDCDD "' + esc(snippet) + '"';
        } else {
          obsText = '<span style="color:var(--text-3)">No observations</span>';
        }

        html += '<div class="dash-card' + (flagged ? ' flagged' : '') + '" data-action="goToStudent" data-sid="' + st.id + '" data-course="' + cid + '">';

        // Header
        html += '<div class="dash-card-header">' +
          '<button class="dash-flag-btn" data-action="toggleFlag" data-cid="' + cid + '" data-sid="' + st.id + '" data-stop-prop="true" title="Flag student" aria-label="Flag student" style="color:' + (flagged ? 'var(--priority)' : 'var(--border-2)') + '">' +
            (flagged ? '\u2691' : '\u2690') +
          '</button>' +
          '<div class="dash-card-info">' +
            '<a class="dash-card-name" href="#/student?id=' + st.id + '&course=' + cid + '" data-stop-prop="true">' + esc(displayName(st)) + '</a>' +
            (st.pronouns ? '<div class="dash-card-pronouns">' + esc(st.pronouns) + '</div>' : '') +
            (st.studentNumber ? '<div style="font-size:0.6rem;color:var(--text-3);font-family:\'SF Mono\',ui-monospace,monospace">#' + esc(st.studentNumber) + '</div>' : '') +
            ((st.designations || []).length > 0 ? (function() { var dh = '<div class="dash-desig-wrap">'; var hasIep = false, hasMod = false; (st.designations || []).forEach(function(code) { var d = BC_DESIGNATIONS[code]; if (!d) return; dh += '<span class="dash-desig-badge' + (d.level > 0 ? ' low-inc' : '') + '" title="' + code + ' \u2014 ' + d.name + '">' + code + '</span>'; if (d.iep) hasIep = true; if (d.modified) hasMod = true; }); if (hasIep) dh += '<span class="dash-iep-tag">IEP</span>'; if (hasMod) dh += '<span class="dash-mod-tag">MOD</span>'; dh += '</div>'; return dh; })() : '') +
          '</div>' +
          '<div class="dash-card-badge" style="background:' + PROF_TINT[op] + '">' +
            '<div class="dash-card-badge-num" style="color:' + PROF_COLORS[op] + '">' + (overall > 0 ? overall.toFixed(1) : '\u2014') + '</div>' +
            '<div class="dash-card-badge-label" style="color:' + PROF_COLORS[op] + '">' + (overall > 0 ? PROF_LABELS[op] : '') + '</div>' +
          '</div>' +
          (missingCount > 0 ? '<span class="dash-card-missing" title="' + missingCount + ' past-due unscored">\u26A0' + missingCount + '</span>' : '') +
        '</div>';

        // Section strip — one card per group (averaged) + one per ungrouped section
        html += '<div class="dash-card-sections">';
        var _grouped = getGroupedSections(cid);
        if (_grouped.groups.length > 0) {
          // Group cards: single averaged score per group
          _grouped.groups.forEach(function(gi) {
            if (gi.sections.length === 0) return;
            var groupVal = getGroupProficiency(cid, st.id, gi.group.id);
            var gr = Math.round(groupVal);
            html += '<div class="dash-section-mini" style="background:' + PROF_TINT[gr] + '">' +
              '<div style="position:absolute;top:0;left:4px;right:4px;height:3px;border-radius:2px;background:' + gi.group.color + '"></div>' +
              '<div class="dash-section-name">' + esc(gi.group.name) + '</div>' +
              '<div class="dash-section-val" style="color:' + PROF_COLORS[gr] + '">' + (groupVal > 0 ? groupVal.toFixed(1) : '\u2014') + '</div>' +
            '</div>';
          });
          // Ungrouped sections: individual cards
          _grouped.ungrouped.forEach(function(sec) {
            var secVal = getSectionProficiency(cid, st.id, sec.id);
            var sr = Math.round(secVal);
            html += '<div class="dash-section-mini" style="background:' + PROF_TINT[sr] + '">' +
              '<div style="position:absolute;top:0;left:4px;right:4px;height:3px;border-radius:2px;background:' + sec.color + '"></div>' +
              '<div class="dash-section-name">' + esc(sec.shortName || sec.name) + '</div>' +
              '<div class="dash-section-val" style="color:' + PROF_COLORS[sr] + '">' + (secVal > 0 ? secVal.toFixed(1) : '\u2014') + '</div>' +
            '</div>';
          });
        } else {
          // No groups — flat section cards
          sections.forEach(function(sec) {
            var secVal = getSectionProficiency(cid, st.id, sec.id);
            var sr = Math.round(secVal);
            html += '<div class="dash-section-mini" style="background:' + PROF_TINT[sr] + '">' +
              '<div style="position:absolute;top:0;left:4px;right:4px;height:3px;border-radius:2px;background:' + sec.color + '"></div>' +
              '<div class="dash-section-name">' + esc(sec.shortName || sec.name) + '</div>' +
              '<div class="dash-section-val" style="color:' + PROF_COLORS[sr] + '">' + (secVal > 0 ? secVal.toFixed(1) : '\u2014') + '</div>' +
            '</div>';
          });
        }
        html += '</div>';

        // Footer
        html += '<div class="dash-card-footer">' +
          '<div class="dash-card-meta">' +
            '<span style="color:' + (pct >= 75 ? 'var(--score-3)' : pct >= 50 ? 'var(--score-2)' : 'var(--score-1)') + '">' + pct + '%</span>' +
            trendIcon[trend] +
          '</div>' +
          '<div class="dash-card-obs">' + obsText + '</div>' +
        '</div>';

        html += '</div>'; // close card
      });
      html += '</div>'; // close grid
    }
    html += '</div>'; // close dash-section (students)
    return html;
  }

  /* ── Main render ────────────────────────────────────────── */
  function render() {
    if (classManagerOpen) { renderClassManager(); return; }
    // If active course is archived, switch to first non-archived
    if (activeCourse && getCourseConfig(activeCourse).archived) {
      var nonArchived = Object.keys(COURSES).find(function(c) { return !getCourseConfig(c).archived; });
      if (nonArchived) { activeCourse = nonArchived; setActiveCourse(nonArchived); }
    }
    var cid = activeCourse;
    var sections = getSections(cid);
    var students = getStudents(cid);
    var flags = getFlags(cid);
    var assessments = getAssessments(cid);
    var allScores = getScores(cid);

    // Sort
    switch (sortMode) {
      case 'last-asc':
        students = sortStudents(students, 'lastName');
        break;
      case 'last-desc':
        students = sortStudents(students, 'lastName').reverse();
        break;
      case 'first-asc':
        students = sortStudents(students, 'firstName');
        break;
      case 'first-desc':
        students = sortStudents(students, 'firstName').reverse();
        break;
      case 'overall-desc':
        students.sort(function(a, b) { return getOverallProficiency(cid, b.id) - getOverallProficiency(cid, a.id); });
        break;
      case 'overall-asc':
        students.sort(function(a, b) {
          var pa = getOverallProficiency(cid, a.id);
          var pb = getOverallProficiency(cid, b.id);
          if (pa === 0 && pb === 0) return 0;
          if (pa === 0) return 1;
          if (pb === 0) return -1;
          return pa - pb;
        });
        break;
      case 'flagged':
        students.sort(function(a, b) {
          var fa = flags[a.id] ? 0 : 1;
          var fb = flags[b.id] ? 0 : 1;
          if (fa !== fb) return fa - fb;
          return (a.lastName||'').localeCompare(b.lastName||'') || (a.firstName||'').localeCompare(b.firstName||'');
        });
        break;
    }

    // Search filter
    if (searchQuery) {
      var q = searchQuery.toLowerCase();
      students = students.filter(function(s) {
        return displayName(s).toLowerCase().includes(q) ||
          (s.firstName||'').toLowerCase().includes(q) ||
          (s.lastName||'').toLowerCase().includes(q) ||
          (s.studentNumber||'').toLowerCase().includes(q);
      });
    }

    if (showFlaggedOnly) {
      students = students.filter(function(s) { return flags[s.id]; });
    }

    var flagCount = Object.keys(flags).length;
    var allStudents = getStudents(cid);

    /* -- Compute class-level data -- */
    var overallVals = allStudents.map(function(s) { return getOverallProficiency(cid, s.id); }).filter(function(v) { return v > 0; });
    var classAvg = overallVals.length > 0 ? overallVals.reduce(function(a, b) { return a + b; }, 0) / overallVals.length : 0;
    var classR = Math.round(classAvg);

    // Section/group-level class averages for overview bars
    var _overviewGrouped = getGroupedSections(cid);
    var _hasOverviewGroups = _overviewGrouped.groups.some(function(g) { return g.sections.length > 0; });
    var sectionClassAvgs;
    if (_hasOverviewGroups) {
      sectionClassAvgs = [];
      _overviewGrouped.groups.forEach(function(gi) {
        if (gi.sections.length === 0) return;
        var vals = allStudents.map(function(s) { return getGroupProficiency(cid, s.id, gi.group.id); }).filter(function(v) { return v > 0; });
        var avg = vals.length > 0 ? vals.reduce(function(a, b) { return a + b; }, 0) / vals.length : 0;
        sectionClassAvgs.push({ section: { shortName: gi.group.name, name: gi.group.name, color: gi.group.color }, avg: avg, count: vals.length });
      });
      _overviewGrouped.ungrouped.forEach(function(sec) {
        var vals = allStudents.map(function(s) { return getSectionProficiency(cid, s.id, sec.id); }).filter(function(v) { return v > 0; });
        var avg = vals.length > 0 ? vals.reduce(function(a, b) { return a + b; }, 0) / vals.length : 0;
        sectionClassAvgs.push({ section: sec, avg: avg, count: vals.length });
      });
    } else {
      sectionClassAvgs = sections.map(function(sec) {
        var vals = allStudents.map(function(s) { return getSectionProficiency(cid, s.id, sec.id); }).filter(function(v) { return v > 0; });
        var avg = vals.length > 0 ? vals.reduce(function(a, b) { return a + b; }, 0) / vals.length : 0;
        return { section: sec, avg: avg, count: vals.length };
      });
    }

    // Tag coverage
    var allTags = getAllTags(cid);
    var tagsWithEvidence = 0;
    var tagCoverageMap = {};
    allTags.forEach(function(tag) {
      var hasEvidence = allStudents.some(function(s) {
        var scores = getTagScores(cid, s.id, tag.id);
        return scores.some(function(sc) { return sc.type === 'summative' && sc.score > 0; });
      });
      tagCoverageMap[tag.id] = hasEvidence;
      if (hasEvidence) tagsWithEvidence++;
    });
    var tagCoveragePct = allTags.length > 0 ? Math.round((tagsWithEvidence / allTags.length) * 100) : 0;

    // Core competency coverage
    var assessedCCs = new Set();
    assessments.forEach(function(a) {
      (a.coreCompetencyIds || []).forEach(function(ccId) { assessedCCs.add(ccId); });
    });
    var ccCounts = {};
    var ccAssessments = {};
    assessments.forEach(function(a) {
      (a.coreCompetencyIds || []).forEach(function(ccId) {
        ccCounts[ccId] = (ccCounts[ccId] || 0) + 1;
        if (!ccAssessments[ccId]) ccAssessments[ccId] = [];
        ccAssessments[ccId].push(a.title || 'Untitled');
      });
    });

    // Recent observations
    var weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    var weekAgoStr = weekAgo.toISOString().slice(0, 10);
    var recentObsCount = 0;
    allStudents.forEach(function(s) {
      var obs = getStudentQuickObs(cid, s.id);
      recentObsCount += obs.filter(function(o) { return o.date >= weekAgoStr; }).length;
    });

    // Action items
    var actionItems = [];

    var uncoveredTags = allTags.filter(function(t) { return !tagCoverageMap[t.id]; });
    if (uncoveredTags.length > 0) {
      var secNames = [];
      var secNameSet = new Set();
      uncoveredTags.forEach(function(t) {
        var sec = getSectionForTag(cid, t.id);
        var name = sec ? (sec.shortName || sec.name) : '';
        if (name && !secNameSet.has(name)) { secNameSet.add(name); secNames.push(name); }
      });
      actionItems.push({ icon: '\uD83D\uDCCB', text: uncoveredTags.length + ' learning standard' + (uncoveredTags.length !== 1 ? 's' : '') + ' not yet assessed (' + secNames.join(', ') + ')', link: '#/assignments?course=' + cid, linkText: 'Plan' });
    }

    var uncoveredCCs = CORE_COMPETENCIES.filter(function(cc) { return !assessedCCs.has(cc.id); });
    if (uncoveredCCs.length > 0) {
      actionItems.push({ icon: '\uD83C\uDFAF', text: uncoveredCCs.length + ' core competenc' + (uncoveredCCs.length !== 1 ? 'ies' : 'y') + ' not yet tagged: ' + uncoveredCCs.map(function(cc) { return cc.label; }).join(', '), link: '#/assignments?course=' + cid, linkText: 'Tag' });
    }

    var lowCoverageStudents = allStudents.filter(function(s) { return getCompletionPct(cid, s.id) < 50; });
    if (lowCoverageStudents.length > 0) {
      actionItems.push({ icon: '\u26A0\uFE0F', text: lowCoverageStudents.length + ' student' + (lowCoverageStudents.length !== 1 ? 's' : '') + ' below 50% evidence coverage', link: '', linkText: '' });
    }

    if (recentObsCount === 0) {
      actionItems.push({ icon: '\uD83D\uDCDD', text: 'No observations recorded this week', link: '#/observations', linkText: 'Observe' });
    }

    var unobservedStudents = allStudents.filter(function(s) { return getStudentQuickObs(cid, s.id).length === 0; });
    if (unobservedStudents.length > 0) {
      actionItems.push({ icon: '\uD83D\uDC64', text: unobservedStudents.length + ' student' + (unobservedStudents.length !== 1 ? 's have' : ' has') + ' no observations yet', link: '#/observations', linkText: 'Observe' });
    }

    /* -- Toolbar (rendered to separate mount) -- */
    document.getElementById('page-toolbar-mount').innerHTML = renderDashToolbar(cid, students, flagCount);

    /* -- Overview Panel -- */
    var html = '';
    html += renderOverviewPanel(cid, sections, allStudents, assessments, classAvg, classR, tagCoveragePct, sectionClassAvgs, tagsWithEvidence, allTags, tagCoverageMap, assessedCCs, ccCounts, ccAssessments, recentObsCount, flagCount, actionItems);

    // Birthday Widget
    html += '</div>'; // close dash-section

    /* -- Student Card Grid -- */
    html += renderStudentCards(cid, students, allStudents, sections, assessments, allScores, flags);

    document.getElementById('main').innerHTML = html;

    // Restore sort dropdown
    var sortSelect = document.querySelector('.dash-sort-select');
    if (sortSelect) sortSelect.value = sortMode;
  }

  /* ── Student Management ─────────────────────────────────── */
  function deleteStudentUI(sid) {
    var students = getStudents(activeCourse);
    var st = students.find(function(s) { return s.id === sid; });
    if (!st) return;
    var dname = displayName(st);
    showConfirm('Delete Student', 'Delete ' + dname + '? This removes all their scores, goals, and notes.', 'Delete', 'danger', function() {
      var snapshot = deleteStudent(activeCourse, sid);
      render();
      showUndoToast('Student deleted', function() {
        var cid = activeCourse;
        var sts = getStudents(cid); sts.push(snapshot.student); saveStudents(cid, sts);
        var sc = getScores(cid); sc[sid] = snapshot.scores; saveScores(cid, sc);
        if (snapshot.goals !== undefined) { var g = getGoals(cid); g[sid] = snapshot.goals; saveGoals(cid, g); }
        if (snapshot.reflections !== undefined) { var r = getReflections(cid); r[sid] = snapshot.reflections; saveReflections(cid, r); }
        if (snapshot.notes !== undefined) { var n = getNotes(cid); n[sid] = snapshot.notes; saveNotes(cid, n); }
        if (snapshot.flagged) { var f = getFlags(cid); f[sid] = true; saveFlags(cid, f); }
        if (snapshot.statuses) { var s = getAssignmentStatuses(cid); Object.assign(s, snapshot.statuses); saveAssignmentStatuses(cid, s); }
        render();
      });
    });
  }

  /* ── Class Manager Student Functions ────────────────────── */
  function cmShowAddStudent() {
    var form = document.getElementById('cm-add-student-form');
    if (form) { form.style.display = 'block'; var el = document.getElementById('cm-add-first'); if (el) el.focus(); }
  }

  function cmCancelStudent() {
    cmEditingStudentId = null;
    var form = document.getElementById('cm-add-student-form');
    if (form) form.style.display = 'none';
    var btn = document.getElementById('cm-save-btn');
    if (btn) btn.textContent = 'Save';
    ['cm-add-first','cm-add-last','cm-add-pref','cm-add-num','cm-add-dob','cm-add-email'].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.value = '';
    });
    var proEl = document.getElementById('cm-add-pro');
    if (proEl) proEl.value = '';
    document.querySelectorAll('.cm-desig-check').forEach(function(cb) { cb.checked = false; });
  }

  function cmSaveStudent() {
    if (!cmSelectedCourse) return;
    var firstName = (document.getElementById('cm-add-first')?.value||'').trim();
    var lastName = (document.getElementById('cm-add-last')?.value||'').trim();
    if (!firstName) {
      var el = document.getElementById('cm-add-first');
      if (el) { el.style.border = '2px solid var(--score-1)'; el.placeholder = 'First name is required'; el.oninput = function() { this.style.border = ''; }; el.focus(); }
      return;
    }
    var preferred = (document.getElementById('cm-add-pref')?.value||'').trim();
    var pronouns = (document.getElementById('cm-add-pro')?.value||'').trim();
    var studentNumber = (document.getElementById('cm-add-num')?.value||'').trim();
    var dateOfBirth = (document.getElementById('cm-add-dob')?.value||'').trim();
    var email = (document.getElementById('cm-add-email')?.value||'').trim();
    var designations = Array.from(document.querySelectorAll('.cm-desig-check:checked')).map(function(cb) { return cb.value; });
    var students = getStudents(cmSelectedCourse);
    var sortName = ((lastName||'') + ' ' + firstName).trim();

    if (cmEditingStudentId) {
      var st = students.find(function(s) { return s.id === cmEditingStudentId; });
      if (st) {
        st.firstName = firstName; st.lastName = lastName; st.preferred = preferred;
        st.pronouns = pronouns; st.sortName = sortName;
        st.studentNumber = studentNumber; st.dateOfBirth = dateOfBirth; st.email = email;
        st.designations = designations; delete st.designation;
        if (!st.attendance) st.attendance = [];
      }
      cmEditingStudentId = null;
    } else {
      students.push({ id: uid(), firstName: firstName, lastName: lastName, preferred: preferred, pronouns: pronouns, studentNumber: studentNumber, dateOfBirth: dateOfBirth, email: email, designations: designations, attendance:[], sortName: sortName, enrolledDate: new Date().toISOString().slice(0,10) });
    }
    saveStudents(cmSelectedCourse, students);
    cmCancelStudent();
    render();
    requestAnimationFrame(function() {
      var detail = document.querySelector('.cm-detail');
      if (detail) detail.scrollTop = 0;
    });
  }

  function cmEditStudent(sid) {
    if (!cmSelectedCourse) return;
    var students = getStudents(cmSelectedCourse);
    var st = students.find(function(s) { return s.id === sid; });
    if (!st) return;
    cmEditingStudentId = sid;
    var form = document.getElementById('cm-add-student-form');
    if (form) form.style.display = 'block';
    var el = function(id) { return document.getElementById(id); };
    if (el('cm-add-first')) el('cm-add-first').value = st.firstName || '';
    if (el('cm-add-last')) el('cm-add-last').value = st.lastName || '';
    if (el('cm-add-pref')) el('cm-add-pref').value = st.preferred || '';
    if (el('cm-add-pro')) el('cm-add-pro').value = st.pronouns || '';
    if (el('cm-add-num')) el('cm-add-num').value = st.studentNumber || '';
    if (el('cm-add-dob')) el('cm-add-dob').value = st.dateOfBirth || '';
    if (el('cm-add-email')) el('cm-add-email').value = st.email || '';
    var desigs = st.designations || [];
    document.querySelectorAll('.cm-desig-check').forEach(function(cb) { cb.checked = desigs.indexOf(cb.value) >= 0; });
    var btn = el('cm-save-btn');
    if (btn) btn.textContent = 'Update';
    if (el('cm-add-first')) el('cm-add-first').focus();
  }

  function cmRemoveStudent(sid) {
    if (!cmSelectedCourse) return;
    deleteStudentUI(sid);
  }

  /* ── Bulk Edit Mode ─────────────────────────────────────── */
  function cmToggleBulk() {
    cmBulkMode = !cmBulkMode;
    cmBulkSelected.clear();
    render();
  }

  function cmBulkToggle(sid) {
    if (cmBulkSelected.has(sid)) cmBulkSelected.delete(sid);
    else cmBulkSelected.add(sid);
    render();
  }

  function cmBulkSelectAll() {
    var students = getStudents(cmSelectedCourse);
    students.forEach(function(s) { cmBulkSelected.add(s.id); });
    render();
  }

  function cmBulkDeselectAll() {
    cmBulkSelected.clear();
    render();
  }

  function cmApplyBulk() {
    if (!cmSelectedCourse || cmBulkSelected.size === 0) return;
    var pronouns = (document.getElementById('cm-bulk-pro')?.value||'').trim();
    var attDate = (document.getElementById('cm-bulk-att-date')?.value||'').trim();
    var attStatus = (document.getElementById('cm-bulk-att-status')?.value||'').trim();
    var students = getStudents(cmSelectedCourse);
    students.forEach(function(st) {
      if (!cmBulkSelected.has(st.id)) return;
      if (pronouns) st.pronouns = pronouns;
      if (attDate && attStatus) {
        if (!st.attendance) st.attendance = [];
        st.attendance.push({ date: attDate, status: attStatus, note: '' });
        st.attendance.sort(function(a,b) { return b.date.localeCompare(a.date); });
      }
    });
    saveStudents(cmSelectedCourse, students);
    cmBulkMode = false;
    cmBulkSelected.clear();
    render();
  }

  function cmImportRoster() {
    var el = document.getElementById('cm-csv-input');
    if (el) el.click();
  }

  function cmHandleCSV(input) {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      var lines = e.target.result.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l; });
      var hdr = (lines[0]||'').toLowerCase();
      var hasHeader = hdr.includes('first') || hdr.includes('name') || hdr.includes('last');
      var start = hasHeader ? 1 : 0;
      var parsed = [];
      for (var i = start; i < lines.length; i++) {
        var parts = lines[i].split(',').map(function(p) { return p.trim(); });
        if (!parts[0]) continue;
        if (hdr.includes('first') || parts.length >= 4) {
          parsed.push({ firstName: parts[0], lastName: parts[1]||'', preferred: parts[2]||'', pronouns: parts[3]||'', studentNumber: parts[4]||'', dateOfBirth: parts[5]||'', email: parts[6]||'' });
        } else {
          var np = parts[0].split(/\s+/);
          parsed.push({ firstName: np[0]||'', lastName: np.slice(1).join(' ')||'', preferred: parts[1]||'', pronouns: parts[2]||'' });
        }
      }
      cmShowImportPreview(parsed);
    };
    reader.readAsText(file);
    input.value = '';
  }

  function cmShowImportPreview(parsed) {
    cmPendingImport = parsed;
    var cid = cmSelectedCourse;
    var existing = getStudents(cid).map(function(s) { return fullName(s).toLowerCase(); });
    var html = '<div style="border:1px solid var(--active);border-radius:var(--radius-sm);padding:10px 12px;margin-top:8px;background:rgba(0,122,255,0.02)">' +
      '<div class="cm-label" style="margin-bottom:6px">Import Preview \u2014 ' + parsed.length + ' student' + (parsed.length !== 1 ? 's' : '') + ' found</div>' +
      '<div style="max-height:180px;overflow-y:auto;margin-bottom:8px">' +
        '<table style="width:100%;border-collapse:collapse;font-size:0.78rem">' +
          '<thead><tr style="border-bottom:1px solid var(--border)">' +
            '<th style="text-align:left;padding:3px 6px" class="cm-label">First</th>' +
            '<th style="text-align:left;padding:3px 6px" class="cm-label">Last</th>' +
            '<th style="text-align:left;padding:3px 6px" class="cm-label">Pronouns</th>' +
            '<th style="text-align:left;padding:3px 6px" class="cm-label">Status</th>' +
          '</tr></thead><tbody>';
    parsed.forEach(function(p) {
      var fn = ((p.firstName||'')+' '+(p.lastName||'')).trim().toLowerCase();
      var dupe = existing.includes(fn);
      html += '<tr style="border-bottom:1px solid var(--divider-subtle)' + (dupe ? ';opacity:0.5' : '') + '">' +
        '<td style="padding:3px 6px">' + esc(p.firstName||'') + '</td>' +
        '<td style="padding:3px 6px">' + esc(p.lastName||'') + '</td>' +
        '<td style="padding:3px 6px">' + esc(p.pronouns||'') + '</td>' +
        '<td style="padding:3px 6px;font-size:0.65rem;font-weight:600;color:' + (dupe ? 'var(--priority)' : 'var(--score-3)') + '">' + (dupe ? 'SKIP' : 'NEW') + '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn btn-primary" style="font-size:0.78rem;padding:6px 14px" data-action="cmConfirmImport">Import</button>' +
        '<button class="btn btn-ghost" style="font-size:0.78rem;padding:6px 10px" data-action="cmCancelImport">Cancel</button>' +
      '</div>' +
    '</div>';
    var el = document.getElementById('cm-import-preview');
    if (el) el.innerHTML = html;
  }

  function cmConfirmImport() {
    if (!cmPendingImport || !cmSelectedCourse) return;
    var students = getStudents(cmSelectedCourse);
    var existingNames = students.map(function(s) { return fullName(s).toLowerCase(); });
    cmPendingImport.forEach(function(p) {
      var fn = ((p.firstName||'')+' '+(p.lastName||'')).trim().toLowerCase();
      if (existingNames.includes(fn)) return;
      var sortName = ((p.lastName||'') + ' ' + (p.firstName||'')).trim();
      students.push({ id: uid(), firstName: p.firstName||'', lastName: p.lastName||'', preferred: p.preferred||'', pronouns: p.pronouns||'', studentNumber: p.studentNumber||'', dateOfBirth: p.dateOfBirth||'', email: p.email||'', attendance:[], sortName: sortName, enrolledDate: new Date().toISOString().slice(0,10) });
    });
    saveStudents(cmSelectedCourse, students);
    cmPendingImport = null;
    render();
  }

  function cmCancelImport() {
    cmPendingImport = null;
    var el = document.getElementById('cm-import-preview');
    if (el) el.innerHTML = '';
  }

  /* ── Class Manager ──────────────────────────────────────── */
  function openClassManager() {
    classManagerOpen = true;
    cmSelectedCourse = activeCourse;
    cmMode = 'edit';
    render();
  }
  function closeClassManager() {
    classManagerOpen = false;
    render();
  }

  function renderClassManager() {
    var courseIds = Object.keys(COURSES);
    var html = '';

    // Top bar
    var detailTitle = cmMode === 'create' ? 'New Class' :
      (cmSelectedCourse && COURSES[cmSelectedCourse] ? COURSES[cmSelectedCourse].name : 'Class Management');
    html += '<div class="cm-topbar">' +
      '<button class="cm-back-btn" data-action="closeClassManager">\u2190 Dashboard</button>' +
      '<span class="cm-topbar-title">Class Management</span>' +
      '<span class="cm-topbar-spacer"></span>' +
      '<span style="font-size:0.75rem;color:var(--text-3)">' + esc(detailTitle) + '</span>' +
    '</div>';

    // Empty state
    if (courseIds.length === 0 && cmMode !== 'create') {
      html += '<div class="cm-empty">' +
        '<div class="cm-empty-icon">\uD83D\uDCDA</div>' +
        '<div class="cm-empty-title">No classes yet</div>' +
        '<div class="cm-empty-text">Create your first class to get started with your gradebook.</div>' +
        '<button class="btn btn-primary" data-action="cmStartCreate" style="margin-top:16px">Create a Class</button>' +
        '<button class="btn btn-ghost" data-action="cmImportTeams" style="margin-top:8px">Import from Teams</button>' +
      '</div>';
      document.getElementById('main').innerHTML = html;
      return;
    }

    html += '<div class="cm-layout">';
    html += renderCmSidebar(courseIds);
    html += '<div class="cm-detail">';

    if (cmMode === 'create') {
      html += renderCmCreateForm();
    } else if (cmRelinkStep > 0 && cmRelinkCid && COURSES[cmRelinkCid]) {
      html += renderCmRelinkPanel(cmRelinkCid);
    } else if (cmSelectedCourse && COURSES[cmSelectedCourse]) {
      html += renderCmDetail(cmSelectedCourse);
    }

    html += '</div></div>';
    // Preserve scroll position of the detail pane across re-renders
    var detailEl = document.querySelector('.cm-detail');
    var scrollTop = detailEl ? detailEl.scrollTop : 0;
    document.getElementById('main').innerHTML = html;
    if (scrollTop > 0) {
      var newDetail = document.querySelector('.cm-detail');
      if (newDetail) newDetail.scrollTop = scrollTop;
    }
  }

  function renderCmSidebar(courseIds) {
    var html = '<div class="cm-sidebar">' +
      '<div class="cm-sidebar-header">' +
        '<span class="cm-sidebar-label">' + courseIds.length + ' Class' + (courseIds.length!==1?'es':'') + '</span>' +
        '<button class="cm-new-btn" data-action="cmStartCreate">+ New</button>' +
        '<button class="cm-new-btn" data-action="cmImportTeams" style="margin-left:4px">Import Teams</button>' +
      '</div>' +
      '<div class="cm-class-list">';
    if (cmMode === 'create') {
      html += '<div class="cm-class-item cm-create-active">' +
        '<div class="cm-class-name" style="color:var(--active)">New Class</div>' +
        '<div class="cm-class-meta">Setting up\u2026</div>' +
      '</div>';
    }
    var activeCids = courseIds.filter(function(cid) { return !getCourseConfig(cid).archived; });
    var archivedCids = courseIds.filter(function(cid) { return getCourseConfig(cid).archived; });
    activeCids.forEach(function(cid) {
      var c = COURSES[cid];
      var sc = getStudents(cid).length;
      var sel = (cid === cmSelectedCourse && cmMode === 'edit') ? ' selected' : '';
      var gs = c.gradingSystem === 'proficiency' ? 'Proficiency' : c.gradingSystem === 'letter' ? 'Letter' : 'Points';
      html += '<div class="cm-class-item' + sel + '" data-action="cmSelectClass" data-cid="' + cid + '">' +
        '<div class="cm-class-name">' + esc(c.name) + '</div>' +
        '<div class="cm-class-meta">' + gs + ' \u00B7 ' + sc + ' student' + (sc!==1?'s':'') + '</div>' +
      '</div>';
    });
    if (archivedCids.length > 0) {
      html += '<div style="padding:8px 12px 4px;font-size:0.6rem;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-top:8px;border-top:1px solid var(--border)">Archived</div>';
      archivedCids.forEach(function(cid) {
        var c = COURSES[cid];
        var sc = getStudents(cid).length;
        var sel = (cid === cmSelectedCourse && cmMode === 'edit') ? ' selected' : '';
        html += '<div class="cm-class-item' + sel + '" data-action="cmSelectClass" data-cid="' + cid + '" style="opacity:0.5">' +
          '<div class="cm-class-name">' + esc(c.name) + '</div>' +
          '<div class="cm-class-meta">' + sc + ' student' + (sc!==1?'s':'') + ' \u00B7 archived</div>' +
        '</div>';
      });
    }
    html += '</div></div>';
    return html;
  }

  function renderCmDetail(cid) {
    var course = COURSES[cid];
    var cc = getCourseConfig(cid);
    var method = cc.calcMethod || course.calcMethod || 'mostRecent';
    var dw = cc.decayWeight != null ? cc.decayWeight : (course.decayWeight || 0.65);
    var cw = cc.categoryWeights || { summative:1.0, formative:0.0 };
    var cwEnabled = cw.formative > 0;
    var lm = getLearningMap(cid);
    var studentCount = getStudents(cid).length;
    var assessCount = getAssessments(cid).length;
    var tagCount = getAllTags(cid).length;

    var html = '<div class="cm-detail-inner">';

    // LEFT COLUMN: Class Details + Students
    html += '<div class="cm-col">';

    // Section 1: Class Details
    html += '<div class="cm-section">' +
      '<div class="cm-section-title">Class Details</div>' +
      '<div class="cm-field">' +
        '<label class="cm-label">Class Name</label>' +
        '<input class="cm-input" id="cm-name" value="' + esc(course.name) + '" data-action-blur="cmUpdateName">' +
      '</div>' +
      '<div class="cm-row">' +
        '<div class="cm-field">' +
          '<label class="cm-label">Grade Level</label>' +
          '<input class="cm-input" id="cm-grade" value="' + esc(course.gradeLevel||'') + '" placeholder="e.g. 8, 10-12" data-action-blur="cmUpdateGrade">' +
        '</div>' +
        '<div class="cm-field">' +
          '<label class="cm-label">Stats</label>' +
          '<div style="display:flex;gap:12px;padding:7px 0;font-size:0.78rem;color:var(--text-2)">' +
            '<span><strong>' + studentCount + '</strong> student' + (studentCount!==1?'s':'') + '</span>' +
            '<span><strong>' + assessCount + '</strong> assessment' + (assessCount!==1?'s':'') + '</span>' +
            '<span><strong>' + tagCount + '</strong> standard' + (tagCount!==1?'s':'') + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="cm-field">' +
        '<label class="cm-label">Description</label>' +
        '<textarea class="cm-textarea" id="cm-desc" placeholder="Optional course description\u2026" data-action-blur="cmUpdateDesc">' + esc(course.description||'') + '</textarea>' +
      '</div>' +
    '</div>';

    // Section 2: Students (Roster)
    var students = getStudents(cid);
    html += '<div class="cm-section">' +
      '<div class="cm-section-title" style="display:flex;align-items:center;justify-content:space-between">' +
        '<span>Students <span style="font-weight:400;color:var(--text-3);text-transform:none;letter-spacing:0">(' + students.length + ')</span></span>' +
        (students.length > 1 ? '<button class="cm-add-link" data-action="cmToggleBulk" style="font-size:0.7rem;padding:2px 8px;border-radius:4px;' + (cmBulkMode?'background:var(--active);color:white':'') + '">' + (cmBulkMode?'Exit Bulk Edit':'Bulk Edit') + '</button>' : '') +
      '</div>';
    if (students.length > 0) {
      html += '<div class="cm-student-list">';
      var sorted = sortStudents(students, 'lastName');
      sorted.forEach(function(st) {
        var pref = st.preferred && st.preferred !== st.firstName ? st.preferred : '';
        html += '<div class="cm-student-row">' +
          (cmBulkMode ? '<input type="checkbox" class="cm-bulk-check" ' + (cmBulkSelected.has(st.id)?'checked':'') + ' data-action="cmBulkToggleCheck" data-sid="' + st.id + '">' : '') +
          '<span class="cm-student-name">' + esc(fullName(st)) + '</span>' +
          (pref ? '<span class="cm-student-pref">"' + esc(pref) + '"</span>' : '') +
          (st.designations || []).map(function(code) { var d = BC_DESIGNATIONS[code]; if (!d) return ''; return '<span class="cm-desig-badge' + (d.level > 0 ? ' low-inc' : '') + '" title="' + code + ' \u2014 ' + esc(d.name) + '">' + esc(code) + '</span>'; }).join('') +
          (function() { var ds = st.designations || []; var hasIep = ds.some(function(c) { return BC_DESIGNATIONS[c]?.iep; }); var hasMod = ds.some(function(c) { return BC_DESIGNATIONS[c]?.modified; }); return (hasIep ? '<span class="cm-iep-tag">IEP</span>' : '') + (hasMod ? '<span class="cm-mod-tag">MOD</span>' : ''); })() +
          (st.pronouns ? '<span class="cm-student-pronouns">' + esc(st.pronouns) + '</span>' : '') +
          (st.studentNumber ? '<span style="font-size:0.65rem;color:var(--text-3);font-family:\'SF Mono\',monospace">#' + esc(st.studentNumber) + '</span>' : '') +
          '<div class="cm-student-actions">' +
            '<button class="cm-delete-mini" data-action="cmEditStudent" data-sid="' + st.id + '" title="Edit" style="font-size:0.65rem">\u270E</button>' +
            '<button class="cm-delete-mini" data-action="cmRemoveStudent" data-sid="' + st.id + '" title="Remove">\u2715</button>' +
          '</div>' +
        '</div>';
      });
      html += '</div>';
    } else {
      html += '<div style="text-align:center;padding:16px;color:var(--text-3);font-size:0.82rem;border:1.5px dashed var(--border);border-radius:var(--radius-sm)">' +
        'No students yet. Add students individually or import a CSV roster.' +
      '</div>';
    }
    // Bulk edit panel
    if (cmBulkMode && students.length > 0) {
      html += '<div class="cm-bulk-panel">' +
        '<div style="display:flex;gap:8px;margin-bottom:8px">' +
          '<button class="cm-add-link" data-action="cmBulkSelectAll" style="font-size:0.7rem">Select All</button>' +
          '<button class="cm-add-link" data-action="cmBulkDeselectAll" style="font-size:0.7rem">Deselect All</button>' +
          '<span style="font-size:0.7rem;color:var(--text-3);margin-left:auto">' + cmBulkSelected.size + ' selected</span>' +
        '</div>' +
        '<div class="cm-student-form" style="gap:8px 12px">' +
          '<div class="cm-field">' +
            '<label class="cm-label">Set Pronouns</label>' +
            pronounsSelect('cm-bulk-pro', '') +
          '</div>' +
          '<div class="cm-field">' +
            '<label class="cm-label">Add Attendance</label>' +
            '<div style="display:flex;gap:6px">' +
              '<input type="date" class="cm-input" id="cm-bulk-att-date" value="' + getTodayStr() + '" style="font-size:0.78rem;flex:1">' +
              '<select class="cm-input" id="cm-bulk-att-status" style="font-size:0.78rem;flex:1">' +
                '<option value="present">Present</option>' +
                '<option value="absent">Absent</option>' +
                '<option value="late">Late</option>' +
                '<option value="excused">Excused</option>' +
              '</select>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:8px">' +
          '<button class="btn btn-primary" data-action="cmApplyBulk" style="font-size:0.78rem;padding:6px 14px" ' + (cmBulkSelected.size===0?'disabled':'') + '>Apply to Selected</button>' +
        '</div>' +
      '</div>';
    }
    // Add/Edit student form
    html += '<div id="cm-add-student-form" style="display:none" class="cm-add-student-form">' +
      '<div class="cm-student-form">' +
        '<div class="cm-field"><label class="cm-label">First Name *</label><input class="cm-input" id="cm-add-first" placeholder="e.g. Amara" style="font-size:0.82rem;padding:6px 10px"></div>' +
        '<div class="cm-field"><label class="cm-label">Last Name</label><input class="cm-input" id="cm-add-last" placeholder="e.g. Osei" style="font-size:0.82rem;padding:6px 10px"></div>' +
        '<div class="cm-field"><label class="cm-label">Preferred Name</label><input class="cm-input" id="cm-add-pref" placeholder="e.g. Amara" style="font-size:0.82rem;padding:6px 10px"></div>' +
        '<div class="cm-field"><label class="cm-label">Pronouns</label>' + pronounsSelect('cm-add-pro', '') + '</div>' +
        '<div class="cm-field"><label class="cm-label">Student Number</label><input class="cm-input" id="cm-add-num" placeholder="e.g. STU-101" style="font-size:0.82rem;padding:6px 10px"></div>' +
        '<div class="cm-field"><label class="cm-label">Email</label><input class="cm-input" id="cm-add-email" type="email" placeholder="student@school.edu" style="font-size:0.82rem;padding:6px 10px"></div>' +
        '<div class="cm-field"><label class="cm-label">Date of Birth</label><input class="cm-input" id="cm-add-dob" type="date" style="font-size:0.82rem;padding:6px 10px"></div>' +
        '<div class="cm-field" style="grid-column:1/-1"><label class="cm-label">Designations</label>' +
          '<div class="desig-check-grid">' +
            Object.entries(BC_DESIGNATIONS).map(function(entry) { var k = entry[0], v = entry[1]; return '<label class="desig-check-item" title="' + esc(v.desc) + '"><input type="checkbox" class="cm-desig-check" value="' + k + '"><span class="desig-check-code">' + k + '</span><span class="desig-check-name">' + esc(v.name) + '</span></label>'; }).join('') +
          '</div>' +
        '</div>' +
        '<div class="cm-field" style="grid-column:1/-1;display:flex;align-items:flex-end;gap:8px;justify-content:flex-end">' +
          '<button class="btn btn-ghost" data-action="cmCancelStudent" style="padding:6px 10px;font-size:0.78rem">Cancel</button>' +
          '<button class="btn btn-primary" id="cm-save-btn" data-action="cmSaveStudent" style="padding:6px 14px;font-size:0.78rem">Save</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="cm-roster-actions">' +
      '<button class="cm-add-link" data-action="cmShowAddStudent" style="padding:4px 0">+ Add Student</button>' +
      '<span style="color:var(--border)">|</span>' +
      '<button class="cm-add-link" data-action="cmImportRoster" style="padding:4px 0">Import Roster</button>' +
      '<input type="file" id="cm-csv-input" accept=".csv,.txt" style="display:none" data-action-change="cmCSV">' +
    '</div>' +
    '<div id="cm-import-preview"></div>' +
    '</div>';

    // Section 3: Grading & Calculation (still in left column)
    var gs = course.gradingSystem || 'proficiency';
    html += '<div class="cm-section">' +
      '<div class="cm-section-title">Grading &amp; Calculation</div>' +
      '<div class="cm-field">' +
        '<label class="cm-label">Grading System</label>' +
        '<div class="cm-seg">' +
          '<button class="cm-seg-btn' + (gs==='proficiency'?' active':'') + '" data-action="cmSetGradingSystem" data-value="proficiency">Proficiency (1\u20134)</button>' +
          '<button class="cm-seg-btn' + (gs==='letter'?' active':'') + '" data-action="cmSetGradingSystem" data-value="letter">Letter (A\u2013F)</button>' +
          '<button class="cm-seg-btn' + (gs==='points'?' active':'') + '" data-action="cmSetGradingSystem" data-value="points">Points</button>' +
        '</div>' +
      '</div>' +
      '<div class="cm-field">' +
        '<label class="cm-label">Calculation Method</label>' +
        '<div class="cm-seg">' +
          '<button class="cm-seg-btn' + (method==='mostRecent'?' active':'') + '" data-action="cmSetCalcMethod" data-value="mostRecent">Most Recent</button>' +
          '<button class="cm-seg-btn' + (method==='highest'?' active':'') + '" data-action="cmSetCalcMethod" data-value="highest">Highest</button>' +
          '<button class="cm-seg-btn' + (method==='mode'?' active':'') + '" data-action="cmSetCalcMethod" data-value="mode">Mode</button>' +
          '<button class="cm-seg-btn' + (method==='decayingAvg'?' active':'') + '" data-action="cmSetCalcMethod" data-value="decayingAvg">Decaying Avg</button>' +
        '</div>' +
      '</div>' +
      '<div class="cm-field" style="' + (method==='decayingAvg'?'':'display:none') + '">' +
        '<label class="cm-label">Decay Weight</label>' +
        '<div class="cm-slider-row">' +
          '<input type="range" min="10" max="95" value="' + Math.round(dw*100) + '" id="cm-decay-slider" data-action-input="cmDecaySlider" style="flex:1">' +
          '<span class="cm-slider-label" id="cm-decay-val">' + Math.round(dw*100) + '%</span>' +
        '</div>' +
        '<div class="cm-hint">Higher values weight recent scores more heavily.</div>' +
      '</div>' +
      '<div class="cm-field">' +
        '<label class="cm-label">Category Weights</label>' +
        '<label style="display:flex;align-items:center;gap:8px;font-size:0.82rem;cursor:pointer;margin-bottom:8px">' +
          '<input type="checkbox" id="cm-cw-enabled" ' + (cwEnabled?'checked':'') + ' data-action-change="cmCwEnabled" style="width:16px;height:16px;accent-color:var(--active)">' +
          'Weight formative assessments separately' +
        '</label>' +
        '<div id="cm-cw-sliders" style="' + (cwEnabled?'':'display:none') + '">' +
          '<div style="display:flex;gap:20px;align-items:center">' +
            '<div style="flex:1">' +
              '<div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text-2);margin-bottom:4px">' +
                '<span>Summative</span><span>Formative</span>' +
              '</div>' +
              '<input type="range" id="cm-cw-range" min="0" max="100" value="' + Math.round(cw.summative*100) + '" data-action-input="cmCwRange" style="width:100%">' +
              '<div style="display:flex;justify-content:space-between;font-size:0.78rem;font-weight:600;margin-top:2px">' +
                '<span id="cm-cw-summ">' + Math.round(cw.summative*100) + '%</span>' +
                '<span id="cm-cw-form">' + Math.round(cw.formative*100) + '%</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="cm-field">' +
        '<label class="cm-label">Report Card Format</label>' +
        '<label style="display:flex;align-items:center;gap:8px;font-size:0.82rem;cursor:pointer">' +
          '<input type="checkbox" id="cm-report-pct" ' + (cc.reportAsPercentage?'checked':'') + ' data-action-change="cmReportPct" style="width:16px;height:16px;accent-color:var(--active)">' +
          'Report final grade as percentage (recommended for grades 10\u201312)' +
        '</label>' +
        '<div class="cm-hint">When enabled, the overall grade on reports displays as a percentage instead of a proficiency level.</div>' +
      '</div>' +
    '</div>';

    html += '</div>'; // close left column

    // RIGHT COLUMN: Curriculum
    html += '<div class="cm-col-curriculum">';

    // Curriculum -- Subjects
    html += '<div class="cm-section">' +
      '<div class="cm-section-title">Curriculum</div>' +
      '<div class="cm-field">' +
        '<label class="cm-label">Subjects</label>';
    (lm.subjects||[]).forEach(function(sub) {
      html += '<div class="cm-subject-row">' +
        '<div class="cm-subject-color" style="background:' + sub.color + '">' +
          '<div class="cm-color-swatch-selected" style="background:' + sub.color + '" data-action="cmToggleColorPalette" data-target="subject" data-subid="' + sub.id + '"></div>' +
          '<div class="cm-color-palette" id="cm-palette-subject-' + sub.id + '"></div>' +
        '</div>' +
        '<input class="cm-input" value="' + esc(sub.name) + '" style="flex:1" data-action-blur="cmSubjectName" data-subid="' + sub.id + '">' +
        '<button class="cm-delete-mini" data-action="cmDeleteSubject" data-subid="' + sub.id + '" title="Delete subject" aria-label="Delete subject">\u2715</button>' +
      '</div>';
    });
    html += '<button class="cm-add-link" data-action="cmAddSubject">+ Add Subject</button></div>';

    // Learning Standards — folder-based UI (mirrors assignments page)
    var compGroups = lm.competencyGroups || [];
    var _cmGrouped = { groups: [], ungrouped: [] };
    var _cmGroupMap = {};
    compGroups.forEach(function(g) { _cmGroupMap[g.id] = { group: g, sections: [] }; });
    (lm.sections || []).forEach(function(sec) {
      if (sec.groupId && _cmGroupMap[sec.groupId]) _cmGroupMap[sec.groupId].sections.push(sec);
      else _cmGrouped.ungrouped.push(sec);
    });
    _cmGrouped.groups = compGroups.map(function(g) { return _cmGroupMap[g.id]; });

    html += '<div class="cm-field"><label class="cm-label">Learning Standards</label>';

    if ((lm.sections||[]).length === 0 && compGroups.length === 0) {
      html += '<div class="cm-curriculum-empty">' +
        '<div class="cm-curriculum-empty-icon">\uD83D\uDCD0</div>' +
        '<div class="cm-curriculum-empty-text">No learning standards yet. Add a standard to start defining your curriculum.</div>' +
      '</div>';
    }

    // Render group folders (reuses .mod-folder pattern from assignments page)
    _cmGrouped.groups.forEach(function(gi) {
      var grp = gi.group;
      var secs = gi.sections;
      var isOpen = !_cmCollapsedStdFolders[grp.id];
      html += '<div class="mod-folder' + (isOpen ? ' open' : '') + '" data-module-id="' + grp.id + '" data-folder-drop="' + grp.id + '">' +
        '<div class="mod-folder-header" data-action="cmToggleStdFolder" data-uid="' + grp.id + '">' +
          '<span class="mod-folder-grip">\u2807</span>' +
          '<span class="mod-folder-chevron">\u25B6</span>' +
          '<span class="mod-folder-color" style="background:' + grp.color + '" title="Change color" data-action="openColorPicker" data-stop-prop="true">' +
            '<input type="color" value="' + grp.color + '" data-action-change="cmCompGroupColor" data-grpid="' + grp.id + '">' +
          '</span>' +
          '<input class="mod-folder-name-input" value="' + esc(grp.name) + '" draggable="false" data-stop-prop="true" data-action-blur="cmCompGroupName" data-grpid="' + grp.id + '">' +
          '<span class="mod-folder-meta">' + secs.length + ' standard' + (secs.length !== 1 ? 's' : '') + '</span>' +
          '<div class="mod-folder-actions" data-stop-prop="true">' +
            '<button class="mod-folder-action delete" data-action="cmDeleteCompGroup" data-grpid="' + grp.id + '" data-count="' + secs.length + '" title="Delete group">\u2715</button>' +
          '</div>' +
        '</div>' +
        '<div class="mod-folder-body">';
      if (secs.length === 0) {
        html += '<div class="mod-folder-empty">Drag standards here or use the group dropdown when editing a standard</div>';
      }
      secs.forEach(function(sec) { html += _cmRenderStdCard(sec, lm, compGroups); });
      html += '</div></div>';
    });

    // Ungrouped standards
    if (_cmGrouped.ungrouped.length > 0 || compGroups.length > 0) {
      var ungOpen = !_cmCollapsedStdFolders['__none__'];
      html += '<div class="mod-folder no-module' + (ungOpen ? ' open' : '') + '" data-module-id="__none__" data-folder-drop="__none__">' +
        '<div class="mod-folder-header" data-action="cmToggleStdFolder" data-uid="__none__">' +
          '<span class="mod-folder-chevron">\u25B6</span>' +
          '<span style="font-size:0.88rem;color:var(--text-3)">\uD83D\uDCC1</span>' +
          '<span class="mod-folder-name" style="font-size:0.95rem;font-weight:500;color:var(--text-3)">Ungrouped</span>' +
          '<span class="mod-folder-meta">' + _cmGrouped.ungrouped.length + ' standard' + (_cmGrouped.ungrouped.length !== 1 ? 's' : '') + '</span>' +
        '</div>' +
        '<div class="mod-folder-body">';
      _cmGrouped.ungrouped.forEach(function(sec) { html += _cmRenderStdCard(sec, lm, compGroups); });
      if (_cmGrouped.ungrouped.length === 0) {
        html += '<div class="mod-folder-empty">All standards are grouped</div>';
      }
      html += '</div></div>';
    } else {
      // No groups at all — render flat
      (lm.sections || []).forEach(function(sec) { html += _cmRenderStdCard(sec, lm, compGroups); });
    }

    // Add buttons
    html += '<button class="add-module-btn" data-action="cmAddCompGroup">+ Add Group</button>';
    html += '<button class="cm-add-link" data-action="cmAddStd">+ Add Standard</button>';
    html += '</div></div>';

    // Section 4: BC Curriculum Link
    var linkedTags = course.curriculumTags || [];
    html += '<div class="cm-section">' +
      '<div class="cm-section-title">BC Curriculum Link</div>';
    if (linkedTags.length > 0) {
      linkedTags.forEach(function(tag) {
        var courseData = CURRICULUM_INDEX ? CURRICULUM_INDEX[tag] : null;
        var courseName = courseData ? courseData.course_name : tag;
        html += '<div class="cm-curric-link">' +
          '<span class="cm-curric-tag">' + esc(tag) + '</span>' +
          '<span class="cm-curric-name">' + esc(courseName) + '</span>' +
        '</div>';
      });
      html += '<button class="cm-relink-btn" data-action="cmStartRelink" data-cid="' + cid + '">Re-link Curriculum</button>';
    } else {
      html += '<div class="cm-curric-unlinked">Not linked to BC Curriculum</div>' +
        '<button class="cm-relink-btn" data-action="cmStartRelink" data-cid="' + cid + '">Link to BC Curriculum</button>';
    }
    html += '</div>';

    html += '</div>'; // close right column (cm-col-curriculum)

    // Actions row
    var isArchived = cc.archived || false;
    html += '<div class="cm-actions-row">' +
      '<button class="cm-action-btn" data-action="cmDuplicateCourse" data-cid="' + cid + '">\u29C9 Duplicate Class</button>' +
      '<button class="cm-action-btn" data-action="cmToggleArchive" data-cid="' + cid + '">' + (isArchived ? '\uD83D\uDCE6 Unarchive Class' : '\uD83D\uDCE6 Archive Class') + '</button>' +
    '</div>';

    // Danger Zone
    html += '<div class="cm-danger-zone">' +
      '<div style="display:flex;align-items:center;gap:12px">' +
        '<button class="cm-danger-btn" data-action="cmDeleteCourse">Delete "' + esc(course.name) + '"</button>' +
        '<span class="cm-hint" style="margin:0">Permanently removes all data for this class.</span>' +
      '</div>' +
    '</div>';

    html += '</div>'; // close cm-detail-inner
    return html;
  }

  /* ── Curriculum Wizard ──────────────────────────────────── */
  function renderCmCreateForm() {
    if (cwStep === 1) return renderCwStep1();
    if (cwStep === 2) return renderCwStep2();
    if (cwStep === 3) return renderCwStep3();
    return '';
  }

  function renderCwStepBar() {
    var labels = ['Choose Courses', 'Class Details', 'Review'];
    return '<div class="cw-steps">' + labels.map(function(l, i) {
      var n = i + 1;
      var cls = n < cwStep ? 'done' : n === cwStep ? 'active' : '';
      return (i > 0 ? '<span class="cw-step-arrow">\u203A</span>' : '') +
        '<div class="cw-step ' + cls + '">' +
          '<span class="cw-step-num">' + (n < cwStep ? '\u2713' : n) + '</span>' +
          '<span>' + l + '</span>' +
        '</div>';
    }).join('') + '</div>';
  }

  function renderCwStep1() {
    var html = '<div class="cm-detail-inner" style="display:block">';
    html += renderCwStepBar();

    if (!cwCurriculumLoaded && !cwLoadError) {
      html += '<div class="cm-section"><div class="cw-empty-msg">Loading BC Curriculum data\u2026</div></div>';
      html += '<div class="cw-footer"><button class="btn btn-ghost" data-action="cmCancelCreate">Cancel</button></div>';
      html += '</div>';
      return html;
    }

    if (cwLoadError) {
      html += '<div class="cm-section"><div class="cw-empty-msg">Could not load BC Curriculum data.<br>You can still create a class with a custom learning map.</div></div>';
      html += '<div class="cw-footer"><button class="btn btn-ghost" data-action="cmCancelCreate">Cancel</button><button class="btn btn-primary" data-action="cwSkipToCustom">Custom Class</button></div>';
      html += '</div>';
      return html;
    }

    // Grade selection
    html += '<div class="cm-section"><div class="cm-section-title">Grade</div><div class="cw-grade-row">';
    [8, 9, 10, 11, 12].forEach(function(g) {
      var active = cwSelectedGrade === g ? ' active' : '';
      html += '<button class="cw-grade-btn' + active + '" data-action="cwSelectGrade" data-grade="' + g + '">Grade ' + g + '</button>';
    });
    html += '</div></div>';

    // Subject selection
    if (cwSelectedGrade !== null) {
      var allCourses = getCoursesByGrade(cwSelectedGrade);
      var bySubject = {};
      allCourses.forEach(function(c) {
        if (!bySubject[c.subject]) bySubject[c.subject] = [];
        bySubject[c.subject].push(c);
      });
      var subjectNames = Object.keys(bySubject).sort();

      html += '<div class="cm-section"><div class="cm-section-title">Subject</div><div class="cw-subject-row">';
      subjectNames.forEach(function(subj) {
        var active = cwSelectedSubject === subj ? ' active' : '';
        var color = SUBJECT_COLOURS[subj] || '#6366f1';
        html += '<button class="cw-subject-btn' + active + '" data-action="cwSelectSubject" data-subject="' + esc(subj) + '">' +
          '<span class="cw-subject-dot" style="background:' + color + '"></span>' + esc(subj) + '</button>';
      });
      html += '</div></div>';

      // Course checklist
      if (cwSelectedSubject && bySubject[cwSelectedSubject]) {
        var courses = bySubject[cwSelectedSubject];
        html += '<div class="cm-section"><div class="cm-section-title">Courses</div>' +
          '<div class="cm-hint" style="margin-bottom:8px">Select one or more courses. Multiple selections create a combined class.</div>' +
          '<div class="cw-course-list">';
        courses.forEach(function(c) {
          var sel = cwSelectedTags.includes(c.short_tag) ? ' selected' : '';
          var fullCourse = CURRICULUM_INDEX[c.short_tag];
          var compCount = 0, catCount = 0;
          if (fullCourse && fullCourse.categories) {
            catCount = fullCourse.categories.length;
            fullCourse.categories.forEach(function(cat) { compCount += (cat.competencies || []).length; });
          }
          html += '<div class="cw-course-item' + sel + '" data-action="cwToggleCourse" data-tag="' + esc(c.short_tag) + '">' +
            '<span class="cw-course-check">' + (sel ? '\u2713' : '') + '</span>' +
            '<span class="cw-course-name">' + esc(c.course_name) + '</span>' +
            '<span class="cw-course-tag">' + esc(c.short_tag) + '</span>' +
            '<span class="cw-course-count">' + catCount + ' categories \u00B7 ' + compCount + ' standards</span>' +
          '</div>';
        });
        html += '</div>';

        if (cwSelectedTags.length > 0) {
          var totalComps = 0;
          cwSelectedTags.forEach(function(tag) {
            var full = CURRICULUM_INDEX[tag];
            if (full && full.categories) {
              full.categories.forEach(function(cat) { totalComps += (cat.competencies || []).length; });
            }
          });
          html += '<div class="cw-selection-summary"><strong>' + cwSelectedTags.length + '</strong> course' + (cwSelectedTags.length !== 1 ? 's' : '') + ' selected \u00B7 <strong>' + totalComps + '</strong> competencies will become gradebook standards</div>';
        }
        html += '</div>';
      }
    }

    html += '<button class="cw-custom-btn" data-action="cwSkipToCustom">\u270E Create a custom class without BC Curriculum</button>';
    html += '<div class="cw-footer"><button class="btn btn-ghost" data-action="cmCancelCreate">Cancel</button>' +
      '<button class="btn btn-primary" data-action="cwGoToStep2" ' + (cwSelectedTags.length === 0 ? 'disabled style="opacity:0.4;pointer-events:none"' : '') + '>Next</button></div>';
    html += '</div>';
    return html;
  }

  function renderCwStep2() {
    var preName = '';
    var preGrade = '';
    if (cwSelectedTags.length > 0 && CURRICULUM_INDEX) {
      var names = cwSelectedTags.map(function(tag) { return CURRICULUM_INDEX[tag]; }).filter(Boolean).map(function(c) { return c.course_name; });
      preName = names.join(' / ');
      preGrade = cwSelectedGrade ? String(cwSelectedGrade) : '';
    }

    var html = '<div class="cm-detail-inner" style="display:block">';
    html += renderCwStepBar();

    html += '<div class="cm-section"><div class="cm-section-title">Class Details</div>' +
      '<div class="cm-field"><label class="cm-label">Class Name</label><input class="cm-input" id="cm-new-name" value="' + esc(preName) + '" placeholder="e.g. English 10" autofocus></div>' +
      '<div style="display:flex;gap:16px"><div class="cm-field" style="flex:1"><label class="cm-label">Grade Level</label><input class="cm-input" id="cm-new-grade" value="' + esc(preGrade) + '" placeholder="e.g. 8, 10-12"></div></div>' +
      '<div class="cm-field"><label class="cm-label">Description</label><textarea class="cm-textarea" id="cm-new-desc" placeholder="Optional"></textarea></div></div>';

    html += '<div class="cm-section"><div class="cm-section-title">Grading &amp; Calculation</div>' +
      '<div class="cm-field"><label class="cm-label">Grading System</label>' +
        '<div class="cm-seg" id="cm-cg-grading">' +
          '<button class="cm-seg-btn active" data-val="proficiency" data-action="cmCreateToggle" data-group="cm-cg-grading">Proficiency (1\u20134)</button>' +
          '<button class="cm-seg-btn" data-val="letter" data-action="cmCreateToggle" data-group="cm-cg-grading">Letter (A\u2013F)</button>' +
          '<button class="cm-seg-btn" data-val="points" data-action="cmCreateToggle" data-group="cm-cg-grading">Points</button>' +
        '</div></div>' +
      '<div class="cm-field"><label class="cm-label">Calculation Method</label>' +
        '<div class="cm-seg" id="cm-cg-calc">' +
          '<button class="cm-seg-btn active" data-val="mostRecent" data-action="cmCreateToggle" data-group="cm-cg-calc">Most Recent</button>' +
          '<button class="cm-seg-btn" data-val="highest" data-action="cmCreateToggle" data-group="cm-cg-calc">Highest</button>' +
          '<button class="cm-seg-btn" data-val="mode" data-action="cmCreateToggle" data-group="cm-cg-calc">Mode</button>' +
          '<button class="cm-seg-btn" data-val="decayingAvg" data-action="cmCreateToggleDecay" data-group="cm-cg-calc">Decaying Avg</button>' +
        '</div></div>' +
      '<div id="cm-cg-decay" class="cm-field" style="display:none"><label class="cm-label">Decay Weight</label>' +
        '<div class="cm-slider-row"><input type="range" min="10" max="95" value="65" id="cm-cg-decay-slider" style="flex:1"><span class="cm-slider-label">65%</span></div>' +
        '<div class="cm-hint">Higher values weight recent scores more heavily.</div></div>' +
    '</div>';

    html += '<div class="cw-footer"><button class="btn btn-ghost" data-action="cwGoBack">Back</button><button class="btn btn-primary" data-action="cwGoToStep3">Next</button></div>';
    html += '</div>';
    return html;
  }

  function renderCwStep3() {
    var html = '<div class="cm-detail-inner" style="display:block">';
    html += renderCwStepBar();

    var className = document.getElementById('cm-new-name')?.value || cwGetPreName();
    var gradeLevel = document.getElementById('cm-new-grade')?.value || (cwSelectedGrade ? String(cwSelectedGrade) : '');

    html += '<div class="cm-section"><div class="cm-section-title">Review</div>' +
      '<div class="cm-field"><label class="cm-label">Class Name</label><div style="font-size:var(--text-lg);font-weight:600;color:var(--text)">' + esc(className || 'Untitled') + '</div></div>' +
      '<div class="cm-field"><label class="cm-label">Grade</label><div style="font-size:var(--text-md);color:var(--text-2)">' + esc(gradeLevel || '\u2014') + '</div></div></div>';

    if (cwSelectedTags.length > 0 && CURRICULUM_INDEX) {
      var subjectColors = ['#0891b2','#7c3aed','#059669','#d97706','#dc2626','#2563eb','#db2777','#4f46e5'];
      var colorIdx = 0;
      cwSelectedTags.forEach(function(tag) {
        var courseData = CURRICULUM_INDEX[tag];
        if (!courseData) return;
        var color = subjectColors[colorIdx % subjectColors.length];
        colorIdx++;
        var cats = courseData.categories || [];
        var totalComps = 0;
        cats.forEach(function(c) { totalComps += (c.competencies || []).length; });
        html += '<div class="cw-review-card">' +
          '<div class="cw-review-title" style="color:' + color + '">' + esc(courseData.course_name) + '</div>' +
          '<div class="cw-review-meta">' + esc(tag) + ' \u00B7 ' + totalComps + ' competencies across ' + cats.length + ' categories</div>' +
          '<div class="cw-review-sections">';
        cats.forEach(function(cat) {
          var compCount = (cat.competencies || []).length;
          html += '<div class="cw-review-sec"><span class="cw-review-sec-dot" style="background:' + color + '"></span>' + esc(cat.name) + '<span class="cw-review-sec-count">' + compCount + ' standard' + (compCount !== 1 ? 's' : '') + '</span></div>';
        });
        html += '</div></div>';
      });
    } else {
      html += '<div class="cm-section"><div class="cw-empty-msg">Custom class \u2014 no curriculum data. You can add sections and tags manually after creation.</div></div>';
    }

    html += '<div class="cw-footer"><button class="btn btn-ghost" data-action="cwGoBack">Back</button><button class="btn btn-primary" data-action="cwFinishCreate">Create Class</button></div>';
    html += '</div>';
    return html;
  }

  /* ── Wizard navigation ──────────────────────────────────── */
  function cwSelectGrade(g) {
    cwSelectedGrade = g;
    cwSelectedSubject = null;
    cwSelectedTags = [];
    renderClassManager();
  }

  function cwSelectSubject(subj) {
    cwSelectedSubject = subj;
    renderClassManager();
  }

  function cwToggleCourse(tag) {
    var idx = cwSelectedTags.indexOf(tag);
    if (idx >= 0) cwSelectedTags.splice(idx, 1);
    else cwSelectedTags.push(tag);
    renderClassManager();
  }

  function cwSkipToCustom() {
    cwSelectedTags = [];
    cwStep = 2;
    renderClassManager();
  }

  function cwGoToStep2() {
    if (cwSelectedTags.length === 0) return;
    cwStep = 2;
    renderClassManager();
  }

  function cwGoToStep3() {
    cwStep2Name = document.getElementById('cm-new-name')?.value || '';
    cwStep2Grade = document.getElementById('cm-new-grade')?.value || '';
    cwStep2Desc = document.getElementById('cm-new-desc')?.value || '';
    cwStep2Grading = (document.querySelector('#cm-cg-grading .cm-seg-btn.active') || {}).dataset?.val || 'proficiency';
    cwStep2Calc = (document.querySelector('#cm-cg-calc .cm-seg-btn.active') || {}).dataset?.val || 'mostRecent';
    cwStep2Decay = document.getElementById('cm-cg-decay-slider')?.value || '65';
    cwStep = 3;
    renderClassManager();
  }

  function cwGoBack() {
    if (cwStep === 3) cwStep = 2;
    else if (cwStep === 2) cwStep = 1;
    renderClassManager();
  }

  function cwGetPreName() {
    if (cwStep2Name) return cwStep2Name;
    if (cwSelectedTags.length > 0 && CURRICULUM_INDEX) {
      return cwSelectedTags.map(function(tag) { return CURRICULUM_INDEX[tag]; }).filter(Boolean).map(function(c) { return c.course_name; }).join(' / ');
    }
    return '';
  }

  function cwFinishCreate() {
    var name = cwStep2Name || cwGetPreName();
    if (!name.trim()) {
      cwStep = 2; renderClassManager();
      requestAnimationFrame(function() {
        var el = document.getElementById('cm-new-name');
        if (el) { el.style.border = '2px solid var(--score-1)'; el.placeholder = 'Class name is required'; el.oninput = function() { this.style.border = ''; }; el.focus(); }
      });
      return;
    }

    var course = createCourse({
      name: name.trim(),
      gradeLevel: (cwStep2Grade || (cwSelectedGrade ? String(cwSelectedGrade) : '')).trim(),
      description: (cwStep2Desc || '').trim(),
      gradingSystem: cwStep2Grading,
      calcMethod: cwStep2Calc,
      decayWeight: parseInt(cwStep2Decay, 10) / 100
    });

    var cc = getCourseConfig(course.id);
    cc.calcMethod = cwStep2Calc;
    cc.decayWeight = parseInt(cwStep2Decay, 10) / 100;
    saveCourseConfig(course.id, cc);

    if (cwSelectedTags.length > 0 && CURRICULUM_INDEX) {
      var map = buildLearningMapFromTags(cwSelectedTags);
      if (map) {
        saveLearningMap(course.id, map);
        updateCourse(course.id, { curriculumTags: cwSelectedTags.slice() });
      }
    }

    cmSelectedCourse = course.id;
    cmMode = 'edit';
    activeCourse = course.id;
    setActiveCourse(course.id);
    render();
  }

  /* ── CM Actions ─────────────────────────────────────────── */
  function cmSelectClass(cid) {
    cmSelectedCourse = cid;
    cmMode = 'edit';
    render();
  }

  function cmStartCreate() {
    cmMode = 'create';
    cmSelectedCourse = null;
    cwStep = 1;
    cwSelectedGrade = null;
    cwSelectedSubject = null;
    cwSelectedTags = [];
    cwLoadError = false;
    loadCurriculumIndex().then(function(idx) {
      cwCurriculumLoaded = !!idx;
      cwLoadError = !idx;
      if (cmMode === 'create' && cwStep === 1) renderClassManager();
    });
    render();
  }

  function cmCancelCreate() {
    cmMode = 'edit';
    cmSelectedCourse = activeCourse;
    render();
  }

  function cmCreateToggle(btn, containerId) {
    document.querySelectorAll('#'+containerId+' .cm-seg-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
  }

  /* ── CM Edit Actions ────────────────────────────────────── */
  function cmUpdateField(field, value, inputEl) {
    if (!cmSelectedCourse) return;
    if (field === 'name' && !value.trim()) {
      if (inputEl) { inputEl.style.border = '2px solid var(--score-1)'; inputEl.placeholder = 'Class name is required'; inputEl.oninput = function() { this.style.border = ''; }; inputEl.focus(); }
      return;
    }
    updateCourse(cmSelectedCourse, { [field]: value.trim() });
    var nameEl = document.querySelector('.cm-class-item.selected .cm-class-name');
    if (field === 'name' && nameEl) nameEl.textContent = value.trim();
  }

  function cmSetGradingSystem(val) {
    if (!cmSelectedCourse) return;
    updateCourse(cmSelectedCourse, { gradingSystem: val });
    renderClassManager();
  }

  function cmSetCalcMethod(val) {
    if (!cmSelectedCourse) return;
    var cc = getCourseConfig(cmSelectedCourse);
    cc.calcMethod = val;
    saveCourseConfig(cmSelectedCourse, cc);
    updateCourse(cmSelectedCourse, { calcMethod: val });
    renderClassManager();
  }

  function cmUpdateDecay(val) {
    if (!cmSelectedCourse) return;
    document.getElementById('cm-decay-val').textContent = val + '%';
    var cc = getCourseConfig(cmSelectedCourse);
    cc.decayWeight = parseInt(val, 10) / 100;
    saveCourseConfig(cmSelectedCourse, cc);
    updateCourse(cmSelectedCourse, { decayWeight: parseInt(val, 10) / 100 });
  }

  function cmToggleReportPct(on) {
    if (!cmSelectedCourse) return;
    var cc = getCourseConfig(cmSelectedCourse);
    cc.reportAsPercentage = on;
    saveCourseConfig(cmSelectedCourse, cc);
  }

  function cmToggleCatWeights(on) {
    document.getElementById('cm-cw-sliders').style.display = on ? '' : 'none';
    if (!cmSelectedCourse) return;
    var cc = getCourseConfig(cmSelectedCourse);
    if (!on) { cc.categoryWeights = { summative:1.0, formative:0.0 }; }
    saveCourseConfig(cmSelectedCourse, cc);
  }

  function cmUpdateCatWeights(val) {
    var summ = parseInt(val, 10);
    var form = 100 - summ;
    document.getElementById('cm-cw-summ').textContent = summ + '%';
    document.getElementById('cm-cw-form').textContent = form + '%';
    if (!cmSelectedCourse) return;
    var cc = getCourseConfig(cmSelectedCourse);
    cc.categoryWeights = { summative: summ/100, formative: form/100 };
    saveCourseConfig(cmSelectedCourse, cc);
  }

  /* ── Re-link Curriculum ─────────────────────────────────── */
  function cmStartRelink(cid) {
    cmRelinkCid = cid;
    cmRelinkStep = 1;
    cwSelectedGrade = null;
    cwSelectedSubject = null;
    var course = COURSES[cid];
    cwSelectedTags = course && course.curriculumTags ? course.curriculumTags.slice() : [];
    cwLoadError = false;
    loadCurriculumIndex().then(function(idx) {
      cwCurriculumLoaded = !!idx;
      cwLoadError = !idx;
      renderClassManager();
    });
    renderClassManager();
  }

  function cmRelinkCancel() {
    cmRelinkCid = null;
    cmRelinkStep = 0;
    cwSelectedTags = [];
    renderClassManager();
  }

  function cmRelinkNext() {
    if (cwSelectedTags.length === 0) return;
    cmRelinkStep = 2;
    renderClassManager();
  }

  function cmRelinkConfirm(mode) {
    if (!cmRelinkCid || cwSelectedTags.length === 0) return;
    var cid = cmRelinkCid;

    if (mode === 'replace') {
      var map = buildLearningMapFromTags(cwSelectedTags);
      if (map) {
        saveLearningMap(cid, map);
        updateCourse(cid, { curriculumTags: cwSelectedTags.slice() });
      }
    } else if (mode === 'merge') {
      var existing = getLearningMap(cid);
      var newMap = buildLearningMapFromTags(cwSelectedTags);
      if (newMap) {
        var existingSubIds = new Set((existing.subjects || []).map(function(s) { return s.id; }));
        (newMap.subjects || []).forEach(function(s) {
          if (!existingSubIds.has(s.id)) existing.subjects.push(s);
        });
        var existingSecIds = new Set((existing.sections || []).map(function(s) { return s.id; }));
        (newMap.sections || []).forEach(function(s) {
          if (!existingSecIds.has(s.id)) {
            existing.sections.push(s);
          } else {
            var existingSec = existing.sections.find(function(es) { return es.id === s.id; });
            var existingTagIds = new Set(existingSec.tags.map(function(t) { return t.id; }));
            s.tags.forEach(function(t) {
              if (!existingTagIds.has(t.id)) existingSec.tags.push(t);
            });
          }
        });
        existing._customized = true;
        saveLearningMap(cid, existing);
        var allTags = new Set((COURSES[cid].curriculumTags || []).concat(cwSelectedTags));
        updateCourse(cid, { curriculumTags: Array.from(allTags) });
      }
    }

    cmRelinkCid = null;
    cmRelinkStep = 0;
    cwSelectedTags = [];
    renderClassManager();
  }

  function renderCmRelinkPanel(cid) {
    var html = '';

    if (cmRelinkStep === 1) {
      html += '<div class="cm-section"><div class="cm-section-title">Re-link to BC Curriculum</div>';

      if (!cwCurriculumLoaded && !cwLoadError) {
        html += '<div class="cw-empty-msg">Loading BC Curriculum data\u2026</div>';
      } else if (cwLoadError) {
        html += '<div class="cw-empty-msg">Could not load BC Curriculum data.</div>';
      } else {
        html += '<div class="cm-field"><label class="cm-label">Grade</label><div class="cw-grade-row">';
        [8, 9, 10, 11, 12].forEach(function(g) {
          html += '<button class="cw-grade-btn' + (cwSelectedGrade === g ? ' active' : '') + '" data-action="cwSelectGrade" data-grade="' + g + '">Grade ' + g + '</button>';
        });
        html += '</div></div>';

        if (cwSelectedGrade) {
          var subjects = getSubjectsByGrade(cwSelectedGrade);
          html += '<div class="cm-field"><label class="cm-label">Subject</label><div class="cw-subject-row">';
          subjects.forEach(function(s) {
            html += '<button class="cw-subject-btn' + (cwSelectedSubject === s ? ' active' : '') + '" data-action="cwSelectSubject" data-subject="' + esc(s) + '">' + esc(s) + '</button>';
          });
          html += '</div></div>';

          var courses = getCoursesByGrade(cwSelectedGrade);
          if (cwSelectedSubject) courses = courses.filter(function(c) { return c.subject === cwSelectedSubject; });

          if (courses.length > 0) {
            html += '<div class="cm-field"><label class="cm-label">Courses</label><div class="cw-course-list">';
            courses.forEach(function(c) {
              var sel = cwSelectedTags.includes(c.short_tag) ? ' selected' : '';
              var fullCourse = CURRICULUM_INDEX[c.short_tag];
              var compCount = 0, catCount = 0;
              if (fullCourse && fullCourse.categories) {
                catCount = fullCourse.categories.length;
                fullCourse.categories.forEach(function(cat) { compCount += (cat.competencies || []).length; });
              }
              html += '<div class="cw-course-item' + sel + '" data-action="cwToggleCourse" data-tag="' + esc(c.short_tag) + '">' +
                '<span class="cw-course-check">' + (sel ? '\u2713' : '') + '</span>' +
                '<span class="cw-course-name">' + esc(c.course_name) + '</span>' +
                '<span class="cw-course-tag">' + esc(c.short_tag) + '</span>' +
                '<span class="cw-course-count">' + catCount + ' categories \u00B7 ' + compCount + ' standards</span>' +
              '</div>';
            });
            html += '</div></div>';
          }
        }

        if (cwSelectedTags.length > 0) {
          var totalComps = 0;
          cwSelectedTags.forEach(function(tag) {
            var full = CURRICULUM_INDEX[tag];
            if (full && full.categories) {
              full.categories.forEach(function(cat) { totalComps += (cat.competencies || []).length; });
            }
          });
          html += '<div class="cw-selection-summary"><strong>' + cwSelectedTags.length + '</strong> course' + (cwSelectedTags.length !== 1 ? 's' : '') + ' selected \u00B7 <strong>' + totalComps + '</strong> competencies</div>';
        }
      }

      html += '<div class="cm-relink-actions">' +
        '<button class="btn btn-ghost" data-action="cmRelinkCancel">Cancel</button>' +
        '<button class="btn btn-primary" data-action="cmRelinkNext"' + (cwSelectedTags.length === 0 ? ' disabled style="opacity:0.5;pointer-events:none"' : '') + '>Next</button>' +
      '</div></div>';

    } else if (cmRelinkStep === 2) {
      var course = COURSES[cid];
      var existingTags = course.curriculumTags || [];
      var tagCount = getAllTags(cid).length;

      html += '<div class="cm-section"><div class="cm-section-title">Confirm Curriculum Change</div>';

      html += '<div class="cm-field"><label class="cm-label">New Curriculum Link</label>';
      cwSelectedTags.forEach(function(tag) {
        var courseData = CURRICULUM_INDEX ? CURRICULUM_INDEX[tag] : null;
        html += '<div class="cm-curric-link"><span class="cm-curric-tag">' + esc(tag) + '</span><span class="cm-curric-name">' + esc(courseData ? courseData.course_name : tag) + '</span></div>';
      });
      html += '</div>';

      if (tagCount > 0) {
        html += '<div class="cm-relink-warning">This class currently has <strong>' + tagCount + '</strong> learning standards with existing score data. Choose how to handle the change:</div>';
      }

      html += '<div class="cm-relink-actions" style="flex-direction:column;gap:8px">';
      if (tagCount > 0) {
        html += '<button class="btn btn-primary" data-action="cmRelinkConfirm" data-mode="merge" style="width:100%;text-align:left;padding:12px 16px"><strong>Merge</strong> \u2014 Add new standards, keep existing ones and all scores</button>' +
          '<button class="cm-relink-btn" data-action="cmRelinkConfirm" data-mode="replace" style="width:100%;text-align:left;padding:12px 16px;border-color:var(--score-2);color:var(--score-2)"><strong>Replace</strong> \u2014 Remove current standards and replace with curriculum. Existing scores may be orphaned.</button>';
      } else {
        html += '<button class="btn btn-primary" data-action="cmRelinkConfirm" data-mode="replace">Apply Curriculum</button>';
      }
      html += '<button class="btn btn-ghost" data-action="cmRelinkBack">Back</button></div></div>';
    }

    return html;
  }

  /* ── CM Delete / Archive / Duplicate ────────────────────── */
  function cmDeleteCourse() {
    if (!cmSelectedCourse) return;
    var name = COURSES[cmSelectedCourse].name;
    showConfirm('Delete "' + name + '"',
      'This permanently removes all students, assessments, scores, and settings. This cannot be undone.',
      'Delete Class', 'danger', function() {
        var wasActive = (cmSelectedCourse === activeCourse);
        deleteCourseData(cmSelectedCourse);
        var remaining = Object.keys(COURSES);
        if (remaining.length > 0) {
          cmSelectedCourse = remaining[0];
          if (wasActive) { activeCourse = remaining[0]; setActiveCourse(remaining[0]); }
        } else {
          cmSelectedCourse = null;
          activeCourse = null;
        }
        cmMode = 'edit';
        render();
      }
    );
  }

  function cmToggleArchive(cid) {
    var cc = getCourseConfig(cid);
    cc.archived = !cc.archived;
    saveCourseConfig(cid, cc);
    renderClassManager();
  }

  function cmDuplicateCourse(sourceCid) {
    var src = COURSES[sourceCid];
    if (!src) return;
    var newCourse = createCourse({
      name: src.name + ' (Copy)',
      gradeLevel: src.gradeLevel || '',
      description: src.description || '',
      gradingSystem: src.gradingSystem || 'proficiency',
      calcMethod: src.calcMethod || 'mostRecent',
      decayWeight: src.decayWeight || 0.65
    });
    var srcCC = getCourseConfig(sourceCid);
    if (Object.keys(srcCC).length > 0) {
      saveCourseConfig(newCourse.id, structuredClone(srcCC));
    }
    var srcMap = getLearningMap(sourceCid);
    if (srcMap && (srcMap.subjects?.length || srcMap.sections?.length)) {
      var clone = structuredClone(srcMap);
      clone._customized = true;
      clone._version = 1;
      saveLearningMap(newCourse.id, clone);
    }
    cmSelectedCourse = newCourse.id;
    cmMode = 'edit';
    render();
  }

  /* ── CM Curriculum Editing ──────────────────────────────── */
  function cmAddSubject() {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var id = 'subj' + Date.now().toString(36);
    map.subjects.push({ id: id, name:'New Subject', color:'#6366f1' });
    saveLearningMap(cmSelectedCourse, map);
    render();
  }

  function cmUpdateSubjectName(subId, val) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var sub = map.subjects.find(function(s) { return s.id === subId; });
    if (sub) { sub.name = val.trim(); saveLearningMap(cmSelectedCourse, map); }
  }

  function cmUpdateSubjectColor(subId, color) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var sub = map.subjects.find(function(s) { return s.id === subId; });
    if (sub) { sub.color = color; saveLearningMap(cmSelectedCourse, map); render(); }
  }

  function cmToggleColorPalette(el) {
    var target = el.dataset.target;
    var id = target === 'subject' ? el.dataset.subid : el.dataset.secid;
    var paletteId = 'cm-palette-' + target + '-' + id;
    var palette = document.getElementById(paletteId);
    if (!palette) return;
    // Close any other open palettes
    document.querySelectorAll('.cm-color-palette.open').forEach(function(p) { if (p.id !== paletteId) p.classList.remove('open'); p.innerHTML = ''; });
    if (palette.classList.contains('open')) { palette.classList.remove('open'); palette.innerHTML = ''; return; }
    var html = '';
    CM_COLORS.forEach(function(c) {
      html += '<div class="cm-color-dot" data-action="cmPickColor" data-target="' + target + '" data-id="' + id + '" data-color="' + c + '" style="background:' + c + '"></div>';
    });
    palette.innerHTML = html;
    palette.classList.add('open');
  }

  function cmPickColor(el) {
    var target = el.dataset.target;
    var id = el.dataset.id;
    var color = el.dataset.color;
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    if (target === 'subject') {
      var sub = map.subjects.find(function(s) { return s.id === id; });
      if (sub) sub.color = color;
    } else {
      var sec = map.sections.find(function(s) { return s.id === id; });
      if (sec) sec.color = color;
    }
    saveLearningMap(cmSelectedCourse, map);
    renderClassManager();
  }

  function cmDeleteSubject(subId) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var sectionCount = map.sections.filter(function(s) { return s.subject === subId; }).length;
    if (sectionCount > 0) {
      showConfirm('Delete Subject', 'This subject has ' + sectionCount + ' section(s). Delete them too?',
        'Delete All', 'danger', function() {
          map.subjects = map.subjects.filter(function(s) { return s.id !== subId; });
          map.sections = map.sections.filter(function(s) { return s.subject !== subId; });
          saveLearningMap(cmSelectedCourse, map);
          render();
        });
    } else {
      map.subjects = map.subjects.filter(function(s) { return s.id !== subId; });
      saveLearningMap(cmSelectedCourse, map);
      render();
    }
  }

  // ── Competency Group CRUD ──────────────────────────────────
  function cmAddCompGroup() {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    if (!map.competencyGroups) map.competencyGroups = [];
    var idx = map.competencyGroups.length;
    var colors = ['#6366f1','#06b6d4','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#64748b'];
    map.competencyGroups.push({
      id: 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5),
      name: 'Group ' + (idx + 1),
      color: colors[idx % colors.length],
      sortOrder: idx
    });
    saveLearningMap(cmSelectedCourse, map);
    renderClassManager();
  }

  function cmUpdateCompGroupName(grpId, val) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var g = (map.competencyGroups || []).find(function(x) { return x.id === grpId; });
    if (g && val.trim()) { g.name = val.trim(); saveLearningMap(cmSelectedCourse, map); }
  }

  function cmUpdateCompGroupColor(grpId, color) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var g = (map.competencyGroups || []).find(function(x) { return x.id === grpId; });
    if (g) { g.color = color; saveLearningMap(cmSelectedCourse, map); _cmRenderWithScroll(); }
  }

  function cmDeleteCompGroup(grpId) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var count = (map.sections || []).filter(function(s) { return s.groupId === grpId; }).length;
    var doDelete = function() {
      map.competencyGroups = (map.competencyGroups || []).filter(function(g) { return g.id !== grpId; });
      (map.sections || []).forEach(function(s) { if (s.groupId === grpId) delete s.groupId; });
      saveLearningMap(cmSelectedCourse, map);
      _cmRenderWithScroll();
    };
    if (count > 0) {
      showConfirm('Delete Group', count + ' standard(s) will become ungrouped. Delete anyway?', 'Delete', 'danger', doDelete);
    } else {
      doDelete();
    }
  }

  function cmUpdateStdGroup(secId, groupId) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var sec = (map.sections || []).find(function(s) { return s.id === secId; });
    if (!sec) return;
    if (groupId) sec.groupId = groupId; else delete sec.groupId;
    saveLearningMap(cmSelectedCourse, map);
    _cmRenderWithScroll();
  }

  // Re-render class manager preserving scroll position
  function _cmRenderWithScroll() {
    var container = document.querySelector('.cm-detail');
    var scrollY = container ? container.scrollTop : window.scrollY;
    renderClassManager();
    requestAnimationFrame(function() {
      var c = document.querySelector('.cm-detail');
      if (c) c.scrollTop = scrollY; else window.scrollTo(0, scrollY);
    });
  }

  // ── Flat Learning Standard CRUD ──────────────────────────────
  function cmAddStd() {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    if (map.subjects.length === 0) {
      map.subjects.push({ id:'subj1', name:'General', color:'#6366f1' });
    }
    var subId = map.subjects[0].id;
    var stdId = 'S' + Date.now().toString(36).slice(-4).toUpperCase();
    var colour = map.subjects.find(function(s) { return s.id===subId; })?.color || '#6366f1';
    map.sections.push({
      id: stdId, subject: subId, name:'New Standard', shortName:'New', color: colour,
      tags: [{ id: stdId, label:'New Standard', text:'', color: colour, subject: subId, name:'New Standard', shortName:'New' }]
    });
    map._flatVersion = 2;
    saveLearningMap(cmSelectedCourse, map);
    render();
    requestAnimationFrame(function() {
      var el = document.getElementById('cm-sec-'+stdId);
      if (el) { el.classList.add('open'); el.scrollIntoView({behavior:'smooth',block:'center'}); }
    });
  }

  function cmUpdateStdName(secId, val) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var sec = map.sections.find(function(s) { return s.id === secId; });
    if (!sec) return;
    var trimmed = val.trim();
    sec.name = trimmed;
    sec.shortName = trimmed.split(' ')[0];
    if (sec.tags[0]) { sec.tags[0].name = trimmed; sec.tags[0].shortName = sec.shortName; }
    saveLearningMap(cmSelectedCourse, map);
  }

  function cmUpdateStdSubject(secId, subId) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var sec = map.sections.find(function(s) { return s.id === secId; });
    if (!sec) return;
    sec.subject = subId;
    if (sec.tags[0]) sec.tags[0].subject = subId;
    saveLearningMap(cmSelectedCourse, map);
  }

  function cmUpdateStdColor(secId, color) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var sec = map.sections.find(function(s) { return s.id === secId; });
    if (!sec) return;
    sec.color = color;
    if (sec.tags[0]) sec.tags[0].color = color;
    saveLearningMap(cmSelectedCourse, map);
    render();
  }

  function cmDeleteStd(secId) {
    showConfirm('Delete Standard', 'Delete this learning standard? Existing scores are preserved.',
      'Delete', 'danger', function() {
        var map = ensureCustomLearningMap(cmSelectedCourse);
        map.sections = map.sections.filter(function(s) { return s.id !== secId; });
        saveLearningMap(cmSelectedCourse, map);
        render();
      });
  }

  function cmUpdateStdLabel(secId, val) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var sec = map.sections.find(function(s) { return s.id === secId; });
    if (sec && sec.tags[0]) { sec.tags[0].label = val.trim(); saveLearningMap(cmSelectedCourse, map); }
  }

  function cmUpdateStdText(secId, val) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var sec = map.sections.find(function(s) { return s.id === secId; });
    if (sec && sec.tags[0]) { sec.tags[0].text = val.trim(); saveLearningMap(cmSelectedCourse, map); }
  }

  function cmUpdateStdCode(secId, val) {
    if (!cmSelectedCourse) return;
    var newId = val.trim().toUpperCase().replace(/[^A-Z0-9._\-]/g, '').slice(0, 10);
    if (!newId || newId === secId) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    // Check uniqueness within learning map
    var exists = map.sections.some(function(s) { return s.id === newId; });
    if (exists) {
      alert('Tag code "' + newId + '" already exists. Please choose a different code.');
      render();
      return;
    }
    // Update section and tag IDs
    var sec = map.sections.find(function(s) { return s.id === secId; });
    if (!sec) return;
    sec.id = newId;
    if (sec.tags[0]) sec.tags[0].id = newId;
    // Update _sectionToTagMap if present
    if (map._sectionToTagMap) {
      Object.keys(map._sectionToTagMap).forEach(function(k) {
        if (map._sectionToTagMap[k] === secId) map._sectionToTagMap[k] = newId;
      });
    }
    saveLearningMap(cmSelectedCourse, map);
    // Update assessment tagIds references
    var assessments = getAssessments(cmSelectedCourse);
    var assessChanged = false;
    assessments.forEach(function(a) {
      var idx = (a.tagIds || []).indexOf(secId);
      if (idx !== -1) { a.tagIds[idx] = newId; assessChanged = true; }
    });
    if (assessChanged) saveAssessments(cmSelectedCourse, assessments);
    // Update score tagId references
    var allScores = getScores(cmSelectedCourse);
    var scoresChanged = false;
    Object.keys(allScores).forEach(function(sid) {
      (allScores[sid] || []).forEach(function(sc) {
        if (sc.tagId === secId) { sc.tagId = newId; scoresChanged = true; }
      });
    });
    if (scoresChanged) saveScores(cmSelectedCourse, allScores);
    render();
  }

  // Legacy aliases
  function cmAddSec() { cmAddStd(); }
  function cmUpdateSecName(secId, val) { cmUpdateStdName(secId, val); }
  function cmUpdateSecSubject(secId, subId) { cmUpdateStdSubject(secId, subId); }
  function cmUpdateSecColor(secId, color) { cmUpdateStdColor(secId, color); }
  function cmDeleteSec(secId) { cmDeleteStd(secId); }
  function cmToggleSec(headerEl) { headerEl.closest('.cm-sec-group').classList.toggle('open'); }
  function cmAddTag(secId) { /* no-op in flat mode */ }
  function cmUpdateTagLabel(secId, tagId, val) { cmUpdateStdLabel(secId, val); }
  function cmUpdateTagText(secId, tagId, val) { cmUpdateStdText(secId, val); }
  function cmDeleteTag(secId, tagId) { cmDeleteStd(secId); }

  /* ── Delegated click handler ────────────────────────────── */
  function _handleClick(e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.dataset.action;
    if (el.dataset.stopProp === 'true') e.stopPropagation();
    var handlers = {
      'openClassManager':     function() { openClassManager(); },
      'closeClassManager':    function() { closeClassManager(); },
      'cmStartCreate':        function() { cmStartCreate(); },
      'cmImportTeams':        function() { if (window.TeamsImport) TeamsImport.open(null, function() { renderClassManager(); }); },
      'cmCancelCreate':       function() { cmCancelCreate(); },
      'cmSelectClass':        function() { cmSelectClass(el.dataset.cid); },
      'cmEditStudent':        function() { cmEditStudent(el.dataset.sid); },
      'cmRemoveStudent':      function() { cmRemoveStudent(el.dataset.sid); },
      'cmCancelStudent':      function() { cmCancelStudent(); },
      'cmSaveStudent':        function() { cmSaveStudent(); },
      'cmShowAddStudent':     function() { cmShowAddStudent(); },
      'cmImportRoster':       function() { cmImportRoster(); },
      'cmConfirmImport':      function() { cmConfirmImport(); },
      'cmCancelImport':       function() { cmCancelImport(); },
      'cmToggleBulk':         function() { cmToggleBulk(); },
      'cmBulkSelectAll':      function() { cmBulkSelectAll(); },
      'cmBulkDeselectAll':    function() { cmBulkDeselectAll(); },
      'cmApplyBulk':          function() { cmApplyBulk(); },
      'cmSetGradingSystem':   function() { cmSetGradingSystem(el.dataset.value); },
      'cmSetCalcMethod':      function() { cmSetCalcMethod(el.dataset.value); },
      'cmToggleColorPalette': function() { cmToggleColorPalette(el); },
      'cmPickColor':          function() { cmPickColor(el); },
      'cmDeleteSubject':      function() { cmDeleteSubject(el.dataset.subid); },
      'cmAddSubject':         function() { cmAddSubject(); },
      'cmToggleSec':          function() { cmToggleSec(el); },
      'cmDeleteSec':          function() { cmDeleteSec(el.dataset.secid); },
      'cmDeleteStd':          function() { cmDeleteStd(el.dataset.secid); },
      'cmDeleteTag':          function() { cmDeleteTag(el.dataset.secid, el.dataset.tagid); },
      'cmAddTag':             function() { cmAddTag(el.dataset.secid); },
      'cmAddSec':             function() { cmAddSec(); },
      'cmAddStd':             function() { cmAddStd(); },
      'cmStartRelink':        function() { cmStartRelink(el.dataset.cid); },
      'cmDuplicateCourse':    function() { cmDuplicateCourse(el.dataset.cid); },
      'cmToggleArchive':      function() { cmToggleArchive(el.dataset.cid); },
      'cmDeleteCourse':       function() { cmDeleteCourse(); },
      'cwSelectGrade':        function() { cwSelectGrade(parseInt(el.dataset.grade, 10)); },
      'cwSelectSubject':      function() { cwSelectSubject(el.dataset.subject); },
      'cwToggleCourse':       function() { cwToggleCourse(el.dataset.tag); },
      'cwSkipToCustom':       function() { cwSkipToCustom(); },
      'cwGoToStep2':          function() { cwGoToStep2(); },
      'cwGoToStep3':          function() { cwGoToStep3(); },
      'cwGoToStep4':          function() { DashCurriculumWizard.cwGoToStep4(); },
      'cwGoBack':             function() { cwGoBack(); },
      'cwFinishCreate':       function() { cwFinishCreate(); },
      'cwAddGroup':           function() { DashCurriculumWizard.cwAddGroup(); },
      'cwDeleteGroup':        function() { DashCurriculumWizard.cwDeleteGroup(el.dataset.gid); },
      'cwToggleGroup':        function() { DashCurriculumWizard.cwToggleGroup(el.dataset.gid); },
      'cwAddCustomComp':      function() { DashCurriculumWizard.cwAddCustomComp(); },
      'cwRemoveCustomComp':   function() { DashCurriculumWizard.cwRemoveCustomComp(el.dataset.secid); },
      'cmAddCompGroup':       function() { cmAddCompGroup(); },
      'cmDeleteCompGroup':    function() { cmDeleteCompGroup(el.dataset.grpid); },
      'cmToggleStdCard':      function() { cmToggleStdCard(el.dataset.secid); },
      'cmToggleStdFolder':    function() { cmToggleStdFolder(el.dataset.uid); },
      'openColorPicker':      function() { var inp = el.querySelector('input[type="color"]'); if (inp) inp.click(); },
      'cmCreateToggle':       function() { cmCreateToggle(el, el.dataset.group); var dp = document.getElementById('cm-cg-decay'); if (dp) dp.style.display = 'none'; },
      'cmCreateToggleDecay':  function() { cmCreateToggle(el, el.dataset.group); document.getElementById('cm-cg-decay').style.display = el.classList.contains('active') && el.dataset.val === 'decayingAvg' ? '' : 'none'; },
      'cmRelinkCancel':       function() { cmRelinkCancel(); },
      'cmRelinkNext':         function() { cmRelinkNext(); },
      'cmRelinkConfirm':      function() { cmRelinkConfirm(el.dataset.mode); },
      'cmRelinkBack':         function() { cmRelinkStep = 1; renderClassManager(); },
      'goToStudent':          function() { Router.navigate('/student?id=' + el.dataset.sid + '&course=' + el.dataset.course); },
      'toggleFlag':           function() { toggleFlag(el.dataset.cid, el.dataset.sid); render(); },
      'toggleFlaggedFilter':  function() { showFlaggedOnly = !showFlaggedOnly; render(); },
      'dashSort':             function() { sortMode = el.value; render(); }
    };
    if (handlers[action]) {
      if (el.tagName !== 'SELECT') e.preventDefault();
      handlers[action]();
    }
  }

  /* ── Input/change/blur handler for non-click events ─────── */
  function _handleInput(e) {
    var el = e.target;

    // Search input
    if (el.dataset.actionInput === 'dashSearch') {
      dashSearchInput(el);
      return;
    }
    // Decay slider
    if (el.dataset.actionInput === 'cmDecaySlider') {
      cmUpdateDecay(el.value);
      return;
    }
    // Category weights slider
    if (el.dataset.actionInput === 'cmCwRange') {
      cmUpdateCatWeights(el.value);
      return;
    }
  }

  function _handleChange(e) {
    var el = e.target;

    // Course select in toolbar
    if (el.dataset.action === 'dashSwitchCourse') {
      switchCourse(el.value);
      return;
    }
    // Sort select
    if (el.dataset.action === 'dashSort') {
      sortMode = el.value;
      render();
      return;
    }
    // CSV import
    if (el.dataset.actionChange === 'cmCSV') {
      cmHandleCSV(el);
      return;
    }
    // Category weights enabled checkbox
    if (el.dataset.actionChange === 'cmCwEnabled') {
      cmToggleCatWeights(el.checked);
      return;
    }
    // Report percentage checkbox
    if (el.dataset.actionChange === 'cmReportPct') {
      cmToggleReportPct(el.checked);
      return;
    }
    // Subject color
    if (el.dataset.actionChange === 'cmSubjectColor') {
      cmUpdateSubjectColor(el.dataset.subid, el.value);
      return;
    }
    // Standard subject
    if (el.dataset.actionChange === 'cmStdSubject') {
      cmUpdateStdSubject(el.dataset.secid, el.value);
      return;
    }
    // Standard color (via palette)
    if (el.dataset.actionChange === 'cmStdColor') {
      cmUpdateStdColor(el.dataset.secid, el.value);
      return;
    }
    // Wizard: competency group color
    if (el.dataset.actionChange === 'cwGroupColor') {
      DashCurriculumWizard.cwUpdateGroupColor(el.dataset.gid, el.value);
      return;
    }
    // Class manager: competency group color
    if (el.dataset.actionChange === 'cmCompGroupColor') {
      cmUpdateCompGroupColor(el.dataset.grpid, el.value);
      return;
    }
    // Class manager: standard group assignment
    if (el.dataset.actionChange === 'cmStdGroup') {
      cmUpdateStdGroup(el.dataset.secid, el.value);
      return;
    }
    // Wizard: competency group assignment dropdown
    if (el.dataset.actionChange === 'cwCompGroupChange') {
      DashCurriculumWizard.cwCompGroupChange(el.dataset.secid, el.value);
      return;
    }
    // Legacy: Section subject/color
    if (el.dataset.actionChange === 'cmSecSubject') {
      cmUpdateSecSubject(el.dataset.secid, el.value);
      return;
    }
    if (el.dataset.actionChange === 'cmSecColor') {
      cmUpdateSecColor(el.dataset.secid, el.value);
      return;
    }
    // Bulk toggle checkbox
    if (el.dataset.action === 'cmBulkToggleCheck') {
      cmBulkToggle(el.dataset.sid);
      return;
    }
  }

  function _handleBlur(e) {
    var el = e.target;

    if (el.dataset.actionBlur === 'cmUpdateName') {
      cmUpdateField('name', el.value, el);
      return;
    }
    if (el.dataset.actionBlur === 'cmUpdateGrade') {
      cmUpdateField('gradeLevel', el.value);
      return;
    }
    if (el.dataset.actionBlur === 'cmUpdateDesc') {
      cmUpdateField('description', el.value);
      return;
    }
    if (el.dataset.actionBlur === 'cwGroupName') {
      DashCurriculumWizard.cwUpdateGroupName(el.dataset.gid, el.value);
      return;
    }
    if (el.dataset.actionBlur === 'cmCompGroupName') {
      cmUpdateCompGroupName(el.dataset.grpid, el.value);
      return;
    }
    if (el.dataset.actionBlur === 'cmSubjectName') {
      cmUpdateSubjectName(el.dataset.subid, el.value);
      return;
    }
    if (el.dataset.actionBlur === 'cmStdCode') {
      cmUpdateStdCode(el.dataset.secid, el.value);
      return;
    }
    if (el.dataset.actionBlur === 'cmStdName') {
      cmUpdateStdName(el.dataset.secid, el.value);
      return;
    }
    if (el.dataset.actionBlur === 'cmStdLabel') {
      cmUpdateStdLabel(el.dataset.secid, el.value);
      return;
    }
    if (el.dataset.actionBlur === 'cmStdText') {
      cmUpdateStdText(el.dataset.secid, el.value);
      return;
    }
    // Legacy blur handlers
    if (el.dataset.actionBlur === 'cmSecName') {
      cmUpdateSecName(el.dataset.secid, el.value);
      return;
    }
    if (el.dataset.actionBlur === 'cmTagLabel') {
      cmUpdateTagLabel(el.dataset.secid, el.dataset.tagid, el.value);
      return;
    }
    if (el.dataset.actionBlur === 'cmTagText') {
      cmUpdateTagText(el.dataset.secid, el.dataset.tagid, el.value);
      return;
    }
  }

  /* ── init / destroy ─────────────────────────────────────── */
  function init(params) {
    // Reset state
    activeCourse = getActiveCourse();
    showFlaggedOnly = false;
    sortMode = 'last-asc';
    searchQuery = '';
    classManagerOpen = false;
    cmMode = 'edit';
    cmSelectedCourse = activeCourse;
    cmEditingStudentId = null;
    cmBulkMode = false;
    cmBulkSelected = new Set();
    cmPendingImport = null;
    cmRelinkCid = null;
    cmRelinkStep = 0;
    cwStep = 1;
    cwSelectedGrade = null;
    cwSelectedSubject = null;
    cwSelectedTags = [];
    cwStep2Name = ''; cwStep2Grade = ''; cwStep2Desc = '';
    cwStep2Grading = 'proficiency'; cwStep2Calc = 'mostRecent'; cwStep2Decay = '65';

    // Dashboard has no sidebar
    document.getElementById('page-layout').classList.add('sidebar-hidden');
    document.getElementById('sidebar-mount').style.display = 'none';

    // Add page-specific class for scoped CSS
    document.getElementById('main').classList.add('page-dashboard');

    // Hide sidebar toggle in dock
    var sidebarBtn = document.querySelector('.tb-btn');
    if (sidebarBtn) sidebarBtn.style.display = 'none';

    // Expose switchCourse globally for dock course selector
    window._pageSwitchCourse = switchCourse;

    // Add delegated listeners
    _addDocListener('click', _handleClick);
    _addDocListener('input', _handleInput);
    _addDocListener('change', _handleChange);
    _addDocListener('blur', _handleBlur, true); // blur doesn't bubble, use capture
    _initCmStdDrag();

    render();

    // Ensure page starts at top
    requestAnimationFrame(function() { document.getElementById('main').scrollTop = 0; });
  }

  function destroy() {
    _listeners.forEach(function(l) {
      document.removeEventListener(l.type, l.handler, l.options);
    });
    _listeners = [];
    if (_dashSearchTimer) clearTimeout(_dashSearchTimer);
    document.getElementById('main').classList.remove('page-dashboard');
    delete window._pageSwitchCourse;
  }

  /* ── Public API ─────────────────────────────────────────── */
  return {
    init: init,
    destroy: destroy,
    render: render,
    switchCourse: switchCourse
  };
})();
