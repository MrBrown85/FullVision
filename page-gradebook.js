/* ── page-gradebook.js — Gradebook (spreadsheet) page module ── */
window.PageGradebook = (function() {
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
  var _scoreDensity = 'comfortable'; // 'compact' or 'comfortable'
  var _scoreTextSize = 13; // base font size in px for score cells
  var _pinnedCols = { name: true, final: true }; // pinnable: name, categories, final
  var _undoStack = [];
  var _scoreMode = null; // null or { assessmentId, studentIdx }
  var filterSections = [];
  var filterModules = [];
  var filterType = 'all';
  var searchQuery = '';
  var sortCol = null;
  var _filterStripOpen = false;
  var _scrollShadowCleanup = null;
  var _tipSource = null;

  /* ── Filter strip toggle ────────────────────────────────── */
  function toggleFilterStrip() {
    _filterStripOpen = !_filterStripOpen;
    var strip = document.getElementById('gb-filter-strip');
    if (strip) strip.classList.toggle('open', _filterStripOpen);
  }
  function clearAllFilters() {
    filterType = 'all'; filterSections = []; filterModules = [];
    render();
  }

  /* ── Course switch ──────────────────────────────────────── */
  function toggleModuleFilter(moduleId) {
    var idx = filterModules.indexOf(moduleId);
    if (idx >= 0) filterModules.splice(idx, 1);
    else filterModules.push(moduleId);
    render();
  }
  async function switchCourse(cid) {
    activeCourse = cid; setActiveCourse(cid);
    await initData(cid);
    filterSections = []; filterModules = []; filterType = 'all';
    render();
  }

  /* ── View & filter controls ─────────────────────────────── */
  function setView(mode) { viewMode = mode; render(); }
  function toggleSectionFilter(secId) {
    var idx = filterSections.indexOf(secId);
    if (idx >= 0) filterSections.splice(idx, 1);
    else filterSections.push(secId);
    render();
  }
  function setTypeFilter(type) { filterType = filterType === type ? 'all' : type; render(); }
  function onSearch(val) { searchQuery = (val || '').toLowerCase().trim(); render(); }
  function toggleSort(key) {
    if (sortCol && sortCol.key === key) sortCol.dir = sortCol.dir === 'asc' ? 'desc' : 'asc';
    else sortCol = { key: key, dir: 'asc' };
    render();
  }
  function sortArrow(key) {
    if (!sortCol || sortCol.key !== key) return '';
    return '<span class="gb-sort-arrow">' + (sortCol.dir === 'asc' ? '▲' : '▼') + '</span>';
  }

  /* ══════════════════════════════════════════════════════════
     MAIN RENDER
     ══════════════════════════════════════════════════════════ */
  function render() {
    var cid = activeCourse;
    var students = sortStudents(getStudents(cid), 'lastName');
    var allAssessments = getAssessments(cid).slice().sort(function(a, b) { return (a.date || '').localeCompare(b.date || ''); });
    var sections = getSections(cid);
    var course = COURSES[cid];
    var isLetter = course.gradingSystem === 'letter';
    var scores = getScores(cid);

    if (searchQuery) {
      students = students.filter(function(s) {
        return displayName(s).toLowerCase().includes(searchQuery) ||
          (s.firstName||'').toLowerCase().includes(searchQuery) ||
          (s.lastName||'').toLowerCase().includes(searchQuery) ||
          (s.studentNumber||'').toLowerCase().includes(searchQuery);
      });
    }

    var assessments = allAssessments;
    if (filterType !== 'all') assessments = assessments.filter(function(a) { return a.type === filterType; });
    if (filterSections.length > 0) {
      assessments = assessments.filter(function(a) { return (a.tagIds || []).some(function(tid) {
        var sec = getSectionForTag(cid, tid);
        return sec && filterSections.includes(sec.id);
      }); });
    }
    if (filterModules.length > 0) {
      assessments = assessments.filter(function(a) { return a.moduleId && filterModules.includes(a.moduleId); });
    }

    var html = '';

    // ── Toolbar ──
    var modules = getModules(cid);
    var activeFilterCount = (filterType !== 'all' ? 1 : 0) + filterSections.length + filterModules.length;

    html += '<div class="gb-toolbar">';
    var courseOpts = Object.values(COURSES).map(function(c) {
      return '<option value="' + c.id + '"' + (c.id===activeCourse?' selected':'') + '>' + c.name + '</option>';
    }).join('');
    html += '<select class="gb-course-select" data-action="switchCourse" aria-label="Select course">' + courseOpts + '</select>';

    html += '<div class="gb-seg-control" role="tablist" aria-label="View mode">' +
      '<button class="gb-seg-btn' + (viewMode==='detailed'?' active':'') + '" data-action="setView" data-mode="detailed" role="tab" aria-selected="' + (viewMode==='detailed') + '">Competencies</button>' +
      '<button class="gb-seg-btn' + (viewMode==='scores'?' active':'') + '" data-action="setView" data-mode="scores" role="tab" aria-selected="' + (viewMode==='scores') + '">Scores</button>' +
      '<button class="gb-seg-btn' + (viewMode==='summary'?' active':'') + '" data-action="setView" data-mode="summary" role="tab" aria-selected="' + (viewMode==='summary') + '">Summary</button>' +
    '</div>';

    html += '<button class="gb-filter-trigger' + (activeFilterCount > 0 ? ' has-filters' : '') + '" data-action="toggleFilterStrip" aria-expanded="' + _filterStripOpen + '" aria-label="Toggle filters' + (activeFilterCount > 0 ? ', ' + activeFilterCount + ' active' : '') + '">' +
      '<span class="filter-icon" aria-hidden="true">☰</span> Filters' + (activeFilterCount > 0 ? ' <span class="filter-count">' + activeFilterCount + '</span>' : '') +
    '</button>';

    html += '<div class="gb-search-wrap"><span class="gb-search-icon">🔍</span><input class="gb-search-input" type="text" placeholder="Search…" value="' + esc(searchQuery) + '" data-action-input="gbSearch" aria-label="Search students"></div>';

    html += '<div style="margin-left:auto;display:flex;align-items:center;gap:12px">' +
      '<span class="gb-toolbar-label">' + (assessments.length !== allAssessments.length ? assessments.length + ' of ' + allAssessments.length : allAssessments.length) + ' assignments · ' + students.length + ' students</span>' +
      '<a class="tb-action-btn" href="#/assignments?course=' + activeCourse + '&new=1">+ New Assessment</a>' +
    '</div>';
    html += '</div>';

    // ── Filter strip ──
    html += '<div class="gb-filter-strip' + (_filterStripOpen ? ' open' : '') + '" id="gb-filter-strip">';
    html += '<span class="gb-filter-strip-label">Type</span><div class="gb-filter-strip-group">' +
      '<button class="gb-type-chip' + (filterType==='summative'?' active':'') + '" data-action="setTypeFilter" data-type="summative">Summative</button>' +
      '<button class="gb-type-chip' + (filterType==='formative'?' active':'') + '" data-action="setTypeFilter" data-type="formative">Formative</button>' +
    '</div>';

    html += '<div class="gb-filter-strip-divider"></div><span class="gb-filter-strip-label">Outcomes</span><div class="gb-filter-strip-group">';
    sections.forEach(function(sec) {
      var isActive = filterSections.includes(sec.id);
      html += '<button class="gb-filter-chip' + (isActive?' active':'') + '" data-action="toggleSectionFilter" data-secid="' + sec.id + '"><span class="chip-dot" style="background:' + sec.color + '"></span>' + esc(sec.shortName || sec.name) + '</button>';
    });
    html += '</div>';

    if (modules.length > 0) {
      html += '<div class="gb-filter-strip-divider"></div><span class="gb-filter-strip-label">Modules</span><div class="gb-filter-strip-group">';
      modules.forEach(function(u) {
        var isActive = filterModules.includes(u.id);
        html += '<button class="gb-filter-chip' + (isActive?' active':'') + '" data-action="toggleModuleFilter" data-moduleid="' + u.id + '"><span class="chip-dot" style="background:' + u.color + '"></span>' + esc(u.name) + '</button>';
      });
      html += '</div>';
    }

    if (activeFilterCount > 0) {
      html += '<button class="gb-filter-clear" data-action="clearAllFilters">Clear all</button>';
    }
    html += '</div>';

    // ── Table ──
    if (viewMode === 'summary') {
      html += renderSummaryTable(cid, students, sections, isLetter, scores);
    } else if (assessments.length === 0) {
      var typeLabel = filterType !== 'all' ? filterType : '';
      var secLabel = filterSections.length > 0 ? ' in the selected sections' : '';
      html += '<div style="text-align:center;padding:60px 20px;color:var(--text-3)">' +
        '<div style="font-size:1.5rem;margin-bottom:8px;opacity:0.4">📋</div>' +
        '<div style="font-family:var(--font-base);font-size:0.95rem;margin-bottom:4px">No ' + typeLabel + ' assignments found' + secLabel + '.</div>' +
        '<div style="font-family:var(--font-base);font-size:0.82rem">Try adjusting your filters or <a href="#/assignments?course=' + cid + '" style="color:var(--active)">create a new assessment</a>.</div>' +
      '</div>';
    } else if (viewMode === 'scores') {
      html += renderScoresTable(cid, students, assessments, sections, isLetter, scores);
    } else {
      html += renderDetailedTable(cid, students, assessments, sections, isLetter, scores);
    }

    document.getElementById('main').innerHTML = html;
    applyStickyLeft();
    initScrollShadows();
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
    table.querySelectorAll('th.gb-overall-col-header, td.gb-overall-col').forEach(function(cell) {
      cell.style.left = overallLeft + 'px';
    });
  }

  /* ── Scroll shadow indicators ──────────────────────────── */
  function initScrollShadows() {
    if (_scrollShadowCleanup) { _scrollShadowCleanup(); _scrollShadowCleanup = null; }
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
    _scrollShadowCleanup = function() { scroller.removeEventListener('scroll', update); };
    requestAnimationFrame(update);
  }

  /* ══════════════════════════════════════════════════════════
     DETAILED VIEW
     ══════════════════════════════════════════════════════════ */
  function renderDetailedTable(cid, students, assessments, sections, isLetter, scores) {
    var cols = [];
    var groups = [];
    var groupIdx = 0;
    assessments.forEach(function(a) {
      var tagIds = a.tagIds || [];
      if (filterSections.length > 0) {
        tagIds = tagIds.filter(function(tid) { var sec = getSectionForTag(cid, tid); return sec && filterSections.includes(sec.id); });
      }
      if (tagIds.length === 0) return;
      var start = cols.length;
      if (a.scoreMode === 'points') {
        var sec = getSectionForTag(cid, tagIds[0]);
        cols.push({ assessmentId: a.id, tagId: '__pts__', isPointsCol: true, tagCode: '/' + (a.maxPoints || 100), sectionColor: sec ? sec.color : 'var(--text-3)', tagText: a.title });
      } else {
        tagIds.forEach(function(tagId) {
          var tag = getTagById(cid, tagId);
          var sec = getSectionForTag(cid, tagId);
          cols.push({ assessmentId: a.id, tagId: tagId, tagCode: tag ? tag.id : tagId, sectionColor: sec ? sec.color : 'var(--text-3)', tagText: tag ? tag.text : '' });
        });
      }
      groups.push({ assessment: a, startIdx: start, count: cols.length - start, groupIdx: groupIdx++ });
    });
    var colGroupMap = cols.map(function(_, i) { return groups.find(function(g) { return i >= g.startIdx && i < g.startIdx + g.count; }); });
    var sortedStudents = applySorting(cid, students, sections, isLetter);

    var html = '<div class="gb-scroll-wrap"><div class="gb-scroll"><table class="gb-table">';

    // Header row 1
    html += '<thead><tr>';
    html += '<th class="gb-corner gb-sortable" rowspan="2" data-action="toggleSort" data-sortkey="name" scope="col">Student' + sortArrow('name') + '</th>';
    html += renderOverallHeader(2);
    groups.forEach(function(g) {
      var a = g.assessment;
      var isPrimary = a.type === 'summative';
      var typeClass = isPrimary ? ' gb-type-summative' : ' gb-type-formative';
      var startClass = g.groupIdx > 0 ? ' gb-group-start' : '';
      var tagSecs = (a.tagIds||[]).map(function(tid) { return getSectionForTag(cid, tid); }).filter(Boolean);
      var stripeColor = tagSecs.length > 0 ? tagSecs[0].color : 'var(--border)';
      var badges = [];
      if (a.scoreMode === 'points') badges.push('<span class="gb-assess-badge">/ ' + (a.maxPoints||100) + '</span>');
      if (a.weight && a.weight !== 1) badges.push('<span class="gb-assess-badge">' + a.weight + 'x</span>');
      html += '<th class="gb-assess-head' + typeClass + startClass + '" colspan="' + g.count + '">' +
        '<div class="gb-assess-head-inner">' +
          '<a class="gb-assess-title" href="#/assignments?course=' + cid + '&open=' + a.id + '" title="Open in Assignments">' + esc(a.title) + '</a>' +
          '<div class="gb-assess-meta"><span class="gb-assess-type-pill ' + (isPrimary?'sum':'form') + '">' + (isPrimary?'Summative':'Formative') + '</span><span class="gb-assess-date">' + formatDate(a.date) + '</span>' + badges.join('') + '</div>' +
        '</div><div class="gb-assess-stripe" style="background:' + stripeColor + '"></div></th>';
    });
    html += '</tr>';

    // Header row 2: tag codes
    html += '<tr>';
    cols.forEach(function(col, i) {
      var g = colGroupMap[i];
      var startClass = (g && g.groupIdx > 0 && g.startIdx === i) ? ' gb-group-start' : '';
      var altClass = (g && g.groupIdx % 2 === 1) ? ' gb-group-alt' : '';
      html += '<th class="gb-tag-header' + startClass + altClass + '" style="border-bottom-color:' + col.sectionColor + ';color:' + col.sectionColor + '">' + esc(col.tagCode) + (col.tagText ? '<div class="gb-tag-tip">' + esc(col.tagText) + '</div>' : '') + '</th>';
    });
    html += '</tr></thead>';

    // Body
    html += '<tbody>';
    sortedStudents.forEach(function(s) {
      html += '<tr data-sid="' + s.id + '">';
      html += '<th class="gb-name" scope="row">' + renderNameCell(cid, s, sections, isLetter) + '</th>';
      html += renderOverallCell(cid, s.id);
      cols.forEach(function(col, i) {
        var g = colGroupMap[i];
        var startClass = (g && g.groupIdx > 0 && g.startIdx === i) ? ' gb-group-start' : '';
        var altClass = (g && g.groupIdx % 2 === 1) ? ' gb-group-alt' : '';
        var assess = assessments.find(function(a) { return a.id === col.assessmentId; });
        if (col.isPointsCol) {
          var max = assess.maxPoints || 100;
          var score = getPointsScore(cid, s.id, col.assessmentId);
          var pct = score > 0 ? Math.round(score / max * 100) : 0;
          var title = score > 0 ? score + '/' + max + ' (' + pct + '%)' : '';
          var cellContent = score > 0
            ? '<div class="gb-pts-display"><span class="gb-pts-score">' + score + '<span class="gb-pts-max">/' + max + '</span></span><span class="gb-pts-pct">' + pct + '%</span></div>'
            : '<span class="gb-pts-empty">·</span>';
          html += '<td class="gb-score gb-score-pts' + startClass + altClass + '" data-aid="' + col.assessmentId + '" data-pts="1" data-sid="' + s.id + '" data-max="' + max + '" data-action="cycleScore" title="' + title + '" role="button" tabindex="0" aria-label="Score for ' + esc(fullName(s)) + ': ' + (title || 'not scored') + '">' + cellContent + '</td>';
        } else {
          var studentScores = scores[s.id] || [];
          var entry = studentScores.find(function(e) { return e.assessmentId === col.assessmentId && e.tagId === col.tagId; });
          var score = entry ? entry.score : 0;
          var assigned = assess && (assess.tagIds||[]).includes(col.tagId);
          var content = score > 0 ? score : (assigned ? '<span class="gb-unscored">·</span>' : '—');
          html += '<td class="gb-score' + startClass + altClass + '" data-aid="' + col.assessmentId + '" data-tid="' + col.tagId + '" data-sid="' + s.id + '" data-action="cycleScore" role="button" tabindex="0" aria-label="' + esc(fullName(s)) + ' ' + esc(col.tagCode) + ': ' + (score > 0 ? (PROF_LABELS[score] || score) : 'not scored') + '"><span class="gb-score-val s' + score + '">' + content + '</span></td>';
        }
      });
      html += '</tr>';
    });

    html += renderClassStatsRow(cid, sortedStudents, cols, groups, sections, scores);
    html += '</tbody></table></div></div>';
    return html;
  }

  /* ══════════════════════════════════════════════════════════
     AVERAGE VIEW
     ══════════════════════════════════════════════════════════ */
  function renderAverageTable(cid, students, assessments, sections, isLetter, scores) {
    var filteredAssessments = assessments.map(function(a) {
      var tagIds = a.tagIds || [];
      if (filterSections.length > 0) tagIds = tagIds.filter(function(tid) { var sec = getSectionForTag(cid, tid); return sec && filterSections.includes(sec.id); });
      return Object.assign({}, a, { _tagIds: tagIds });
    }).filter(function(a) { return a._tagIds.length > 0; });

    var sortedStudents = applySorting(cid, students, sections, isLetter);
    var html = '<div class="gb-scroll-wrap"><div class="gb-scroll"><table class="gb-table">';

    html += '<thead><tr>';
    html += '<th class="gb-corner gb-sortable" data-action="toggleSort" data-sortkey="name">Student' + sortArrow('name') + '</th>';
    html += renderOverallHeader();
    filteredAssessments.forEach(function(a, ai) {
      var isPrimary = a.type === 'summative';
      var typeClass = isPrimary ? ' gb-type-summative' : ' gb-type-formative';
      var startClass = ai > 0 ? ' gb-group-start' : '';
      var tagSecs = (a.tagIds||[]).map(function(tid) { return getSectionForTag(cid, tid); }).filter(Boolean);
      var stripeColor = tagSecs.length > 0 ? tagSecs[0].color : 'var(--border)';
      html += '<th class="gb-assess-head gb-sortable' + typeClass + startClass + '" style="min-width:80px" data-action="toggleSort" data-sortkey="avg-' + a.id + '">' +
        '<div class="gb-assess-head-inner"><a class="gb-assess-title" href="#/assignments?course=' + cid + '&open=' + a.id + '" title="Open in Assignments" data-action="stopPropOnly" data-stop-prop="true">' + esc(a.title) + '</a>' +
        '<div class="gb-assess-meta"><span class="gb-assess-type-pill ' + (isPrimary?'sum':'form') + '">' + (isPrimary?'S':'F') + '</span><span class="gb-assess-date">' + formatDate(a.date) + '</span>' + sortArrow('avg-'+a.id) + '</div></div>' +
        '<div class="gb-assess-stripe" style="background:' + stripeColor + '"></div></th>';
    });
    html += '</tr></thead>';

    html += '<tbody>';
    sortedStudents.forEach(function(s) {
      html += '<tr data-sid="' + s.id + '"><th class="gb-name" scope="row">' + renderNameCell(cid, s, sections, isLetter) + '</th>';
      html += renderOverallCell(cid, s.id);
      filteredAssessments.forEach(function(a, ai) {
        var startClass = ai > 0 ? ' gb-group-start' : '';
        var altClass = ai % 2 === 1 ? ' gb-group-alt' : '';
        var studentScores = scores[s.id] || [];
        var isPoints = a.scoreMode === 'points';
        var tagScores = a._tagIds.map(function(tid) { var e = studentScores.find(function(e) { return e.assessmentId === a.id && e.tagId === tid; }); return e ? e.score : 0; }).filter(function(v) { return v > 0; });
        if (tagScores.length === 0) {
          html += '<td class="gb-avg-cell' + startClass + altClass + '"><span class="gb-avg-val" style="color:var(--text-3)">—</span></td>';
        } else if (isPoints) {
          var ptsAvg = tagScores.reduce(function(x,y){return x+y;},0)/tagScores.length;
          var max = a.maxPoints || 100;
          html += '<td class="gb-avg-cell' + startClass + altClass + '"><span class="gb-avg-val">' + ptsAvg.toFixed(1) + '</span><span class="gb-avg-label" style="color:var(--text-3)">/ ' + max + '</span></td>';
        } else {
          var avg = tagScores.reduce(function(x,y){return x+y;},0)/tagScores.length;
          var r = Math.round(avg);
          html += '<td class="gb-avg-cell' + startClass + altClass + '"><span class="gb-avg-val" style="color:' + (PROF_COLORS[r]||PROF_COLORS[0]) + '">' + avg.toFixed(1) + '</span><span class="gb-avg-label" style="color:' + (PROF_COLORS[r]||PROF_COLORS[0]) + '">' + (PROF_LABELS[r]||'') + '</span></td>';
        }
      });
      html += '</tr>';
    });

    // Stats row
    html += '<tr class="gb-stats-row"><th class="gb-name" scope="row">Class Average</th>';
    html += renderOverallStatsCell(cid, sortedStudents);
    filteredAssessments.forEach(function(a, ai) {
      var startClass = ai > 0 ? ' gb-group-start' : '';
      var altClass = ai % 2 === 1 ? ' gb-group-alt' : '';
      var vals = sortedStudents.map(function(s) {
        var ss = scores[s.id]||[];
        var ts = a._tagIds.map(function(tid) { var e = ss.find(function(e) { return e.assessmentId===a.id && e.tagId===tid; }); return e?e.score:0; }).filter(function(v){return v>0;});
        return ts.length > 0 ? ts.reduce(function(x,y){return x+y;},0)/ts.length : null;
      }).filter(function(v) { return v !== null; });
      var isPoints = a.scoreMode === 'points';
      if (vals.length === 0) html += '<td class="gb-avg-cell' + startClass + altClass + '"><span class="gb-avg-val" style="color:var(--text-3)">—</span></td>';
      else if (isPoints) { var avg = vals.reduce(function(a,b){return a+b;},0)/vals.length; html += '<td class="gb-avg-cell' + startClass + altClass + '"><span class="gb-avg-val" style="font-weight:700">' + avg.toFixed(1) + '</span><span class="gb-avg-label" style="color:var(--text-3)">/ ' + (a.maxPoints||100) + '</span></td>'; }
      else { var avg = vals.reduce(function(a,b){return a+b;},0)/vals.length; var r = Math.round(avg); html += '<td class="gb-avg-cell' + startClass + altClass + '"><span class="gb-avg-val" style="color:' + PROF_COLORS[r] + ';font-weight:700">' + avg.toFixed(1) + '</span><span class="gb-avg-label" style="color:' + PROF_COLORS[r] + '">' + (PROF_LABELS[r]||'') + '</span></td>'; }
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
    var cc = getCourseConfig(cid);
    var cw = getCategoryWeights(cid);
    var isCompact = _scoreDensity === 'compact';
    var rowH = isCompact ? 'gb-scores-compact' : '';

    // Assignments sorted newest-first (left)
    var sortedAssess = assessments.slice().sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });

    var html = '<div class="gb-scores-toolbar">' +
      '<div class="gb-scores-pin-toggles">' +
        '<button class="gb-scores-pin-btn' + (_pinnedCols.categories ? ' active' : '') + '" data-action="togglePin" data-col="categories" title="Toggle category columns">Summ/Form</button>' +
        '<button class="gb-scores-pin-btn' + (_pinnedCols.final ? ' active' : '') + '" data-action="togglePin" data-col="final" title="Toggle final column">Final</button>' +
      '</div>' +
      '<div style="flex:1"></div>' +
      '<div class="gb-scores-size-controls">' +
        '<button class="gb-scores-size-btn" data-action="decreaseTextSize" title="Decrease text size">\u2212</button>' +
        '<span class="gb-scores-size-label">' + _scoreTextSize + 'px</span>' +
        '<button class="gb-scores-size-btn" data-action="increaseTextSize" title="Increase text size">+</button>' +
      '</div>' +
      '<button class="gb-scores-density-btn" data-action="toggleDensity" title="Toggle compact/comfortable">' +
        (_scoreDensity === 'compact' ? '\u2630' : '\u2261') + '</button>' +
      '<button class="gb-scores-export-btn" data-action="exportScoresCSV" title="Export CSV">\u2913 Export</button>' +
      '<button class="gb-scores-add-btn" data-action="showAddAssessPopover" title="New assignment">+ New</button>' +
    '</div>';

    html += '<div class="gb-scores-wrap"><div class="gb-scores-scroll"><table class="gb-scores-table ' + rowH + '" style="font-size:' + _scoreTextSize + 'px">';

    // Header row — student name + frozen cols + assignment columns
    html += '<thead><tr>';
    html += '<th class="gb-scores-corner gb-scores-sticky">Student</th>';
    if (_pinnedCols.categories) {
      html += '<th class="gb-scores-frozen">Summ % <span class="gb-pin active" data-action="togglePin" data-col="categories" title="Unpin">\uD83D\uDCCC</span></th>';
      html += '<th class="gb-scores-frozen">Form %</th>';
    } else {
      html += '<th class="gb-scores-frozen" style="display:none"></th>';
    }
    if (_pinnedCols.final) {
      html += '<th class="gb-scores-frozen gb-scores-final">Final <span class="gb-pin active" data-action="togglePin" data-col="final" title="Unpin">\uD83D\uDCCC</span></th>';
    }
    sortedAssess.forEach(function(a) {
      var isPrimary = a.type === 'summative';
      var typeClass = isPrimary ? ' gb-scores-summ' : ' gb-scores-form';
      var maxPts = a.scoreMode === 'points' ? ' / ' + (a.maxPoints || 100) : '';
      // Get section color for tag stripe
      var tagSecs = (a.tagIds || []).map(function(tid) { return getSectionForTag(cid, tid); }).filter(Boolean);
      var stripeColor = tagSecs.length > 0 ? tagSecs[0].color : 'var(--border)';
      html += '<th class="gb-scores-assess-head' + typeClass + '" data-aid="' + a.id + '" data-action-dblclick="startScoreMode" title="' + esc(a.title) + ' — Double-click to score">' +
        '<div class="gb-scores-assess-outer">' +
          '<div class="gb-scores-assess-inner">' +
            '<div class="gb-scores-assess-text">' +
              '<span class="gb-scores-assess-name">' + esc(a.title) + '</span>' +
              '<span class="gb-scores-assess-meta">' + formatDate(a.date) + maxPts + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="gb-scores-assess-stripe" style="background:' + stripeColor + '"></div>' +
      '</th>';
    });
    html += '</tr></thead>';

    // Data rows
    html += '<tbody>';
    sortedStudents.forEach(function(s, si) {
      var altClass = si % 2 === 1 ? ' gb-scores-alt' : '';
      html += '<tr class="gb-scores-row' + altClass + '" data-sid="' + s.id + '">';
      html += '<td class="gb-scores-name gb-scores-sticky">' + esc(fullName(s)) + '</td>';

      // Frozen summary columns
      if (_pinnedCols.categories) {
        // Summative %: average of summative scores only
        var summScores = (scores[s.id] || []).filter(function(sc) { return sc.type === 'summative' && sc.score > 0; });
        var summAvg = summScores.length > 0 ? summScores.reduce(function(a, b) { return a + b.score; }, 0) / summScores.length : 0;
        var summPct = summAvg > 0 ? Math.round(summAvg / 4 * 100) : 0;
        html += '<td class="gb-scores-frozen">' + (summPct > 0 ? summPct + '%' : '\u2014') + '</td>';
        // Formative %
        var formScores = (scores[s.id] || []).filter(function(sc) { return sc.type === 'formative' && sc.score > 0; });
        var formAvg = formScores.length > 0 ? formScores.reduce(function(a, b) { return a + b.score; }, 0) / formScores.length : 0;
        var formPct = formAvg > 0 ? Math.round(formAvg / 4 * 100) : 0;
        html += '<td class="gb-scores-frozen">' + (formPct > 0 ? formPct + '%' : '\u2014') + '</td>';
      }
      if (_pinnedCols.final) {
        var overall = getOverallProficiency(cid, s.id);
        var finalPct = overall > 0 ? Math.round(overall / 4 * 100) : 0;
        var fr = Math.round(overall);
        html += '<td class="gb-scores-frozen gb-scores-final" style="color:' + (overall > 0 ? PROF_COLORS[fr] : 'var(--text-3)') + ';font-weight:700">' + (finalPct > 0 ? finalPct + '%' : '\u2014') + '</td>';
      }

      // Score cells per assignment
      sortedAssess.forEach(function(a) {
        var studentScores = scores[s.id] || [];
        var tagIds = a.tagIds || [];
        // Get average score across all tags in this assessment for this student
        var tagScores = tagIds.map(function(tid) {
          var entry = studentScores.find(function(e) { return e.assessmentId === a.id && e.tagId === tid; });
          return entry ? entry.score : 0;
        }).filter(function(v) { return v > 0; });
        var val = tagScores.length > 0 ? tagScores.reduce(function(x, y) { return x + y; }, 0) / tagScores.length : 0;
        var isPoints = a.scoreMode === 'points';
        var display, cellStyle, cellClass = '';
        if (val > 0) {
          var r = Math.round(val);
          cellStyle = 'background:' + PROF_TINT[r] + ';color:' + PROF_COLORS[r];
          display = isPoints ? val.toFixed(0) : val.toFixed(1);
          // Warning for out-of-range (>4 for proficiency, >maxPoints for points)
          var maxVal = isPoints ? (a.maxPoints || 100) : 4;
          if (val > maxVal) cellClass = ' gb-scores-warning';
        } else {
          // Check zero policy for missing scores
          var missingPolicy = a.missingPolicy || cc.missingPolicy || 'exclude';
          var isPastDue = a.dueDate && a.dueDate < new Date().toISOString().slice(0, 10);
          if (missingPolicy === 'zero' && isPastDue) {
            cellStyle = 'color:var(--score-1)';
            display = '<span class="gb-scores-zero">0</span>';
          } else if (isPastDue) {
            cellStyle = 'background:rgba(255,149,0,0.06);color:var(--text-3)';
            display = '<span class="gb-scores-missing">\u2014</span>';
          } else {
            cellStyle = 'color:var(--text-3)';
            display = '\u2014';
          }
        }
        var isScoreModeCell = _scoreMode && _scoreMode.assessmentId === a.id && si === _scoreMode.studentIdx;
        var isScoreModeCol = _scoreMode && _scoreMode.assessmentId === a.id;
        html += '<td class="gb-scores-cell' + (isScoreModeCell ? ' gb-scores-focus' : '') + (isScoreModeCol ? ' gb-scores-col-active' : '') + cellClass + '" style="' + cellStyle + '" data-action="editScoreCell" data-aid="' + a.id + '" data-sid="' + s.id + '">' +
          '<span class="gb-scores-val">' + display + '</span>' +
        '</td>';
      });

      html += '</tr>';
    });
    html += '</tbody></table></div></div>';
    return html;
  }

  /* ══════════════════════════════════════════════════════════
     SUMMARY VIEW
     ══════════════════════════════════════════════════════════ */
  function renderSummaryTable(cid, students, sections, isLetter, scores) {
    var sortedStudents = applySorting(cid, students, sections, isLetter);
    var html = '<div class="gb-scroll-wrap"><div class="gb-scroll"><table class="gb-table">';

    // Build columns: one per group + one per ungrouped section
    var _gbGrouped = getGroupedSections(cid);
    var _hasGbGroups = _gbGrouped.groups.some(function(gi) { return gi.sections.length > 0; });
    var columns = [];
    if (_hasGbGroups) {
      _gbGrouped.groups.forEach(function(gi) {
        if (gi.sections.length === 0) return;
        columns.push({ type: 'group', group: gi.group, sections: gi.sections, id: 'grp-' + gi.group.id, name: gi.group.name, color: gi.group.color });
      });
      _gbGrouped.ungrouped.forEach(function(sec) {
        columns.push({ type: 'section', section: sec, id: 'sec-' + sec.id, name: sec.shortName || sec.name, color: sec.color });
      });
    } else {
      sections.forEach(function(sec) {
        columns.push({ type: 'section', section: sec, id: 'sec-' + sec.id, name: sec.shortName || sec.name, color: sec.color });
      });
    }

    // Header row
    html += '<thead><tr><th class="gb-corner gb-sortable" data-action="toggleSort" data-sortkey="name">Student' + sortArrow('name') + '</th>';
    html += renderOverallHeader();
    if (isLetter) html += '<th class="gb-summary-header gb-sortable" data-action="toggleSort" data-sortkey="grade">Grade' + sortArrow('grade') + '</th>';
    columns.forEach(function(col) {
      html += '<th class="gb-summary-header gb-sortable" style="border-bottom:3px solid ' + col.color + '" data-action="toggleSort" data-sortkey="' + col.id + '">' + esc(col.name) + sortArrow(col.id) + '</th>';
    });
    html += '<th class="gb-summary-header gb-sortable" data-action="toggleSort" data-sortkey="coverage">Coverage' + sortArrow('coverage') + '</th>';
    html += '<th class="gb-summary-header">Trend</th>';
    html += '</tr></thead><tbody>';

    // Data rows
    sortedStudents.forEach(function(s) {
      html += '<tr data-sid="' + s.id + '"><th class="gb-name" scope="row">' + renderNameCell(cid, s, sections, isLetter) + '</th>';
      html += renderOverallCell(cid, s.id);
      if (isLetter) html += renderSummaryCell(cid, s.id, { type:'grade' });
      columns.forEach(function(col) {
        if (col.type === 'group') {
          var gp = getGroupProficiency(cid, s.id, col.group.id);
          var gr = Math.round(gp);
          html += '<td class="gb-summary"' + (gp > 0 ? ' style="background:linear-gradient(' + PROF_TINT[gr] + ',' + PROF_TINT[gr] + '),var(--surface)"' : '') + '><span class="gb-summary-val" style="color:' + (gp > 0 ? PROF_COLORS[gr] : 'var(--text-3)') + '">' + (gp > 0 ? gp.toFixed(1) : '\u2014') + '</span></td>';
        } else {
          html += renderSummaryCell(cid, s.id, { type:'section', section:col.section });
        }
      });
      var pctV = getCompletionPct(cid, s.id);
      html += '<td class="gb-summary" style="text-align:center"><span class="gb-summary-val" style="color:' + (pctV>=75?'var(--score-3)':pctV>=50?'var(--score-2)':'var(--score-1)') + '">' + pctV + '%</span></td>';
      var allSc = (scores[s.id]||[]).filter(function(sc) { return sc.type==='summative' && sc.score>0; });
      var trendIcon = '<span style="color:var(--text-3)">—</span>';
      if (allSc.length >= 4) {
        allSc.sort(function(a,b){return (a.date||'').localeCompare(b.date||'');});
        var mid = Math.floor(allSc.length/2);
        var earlyAvg = allSc.slice(0,mid).reduce(function(a,b){return a+b.score;},0)/mid;
        var lateAvg = allSc.slice(mid).reduce(function(a,b){return a+b.score;},0)/(allSc.length-mid);
        if (lateAvg > earlyAvg + 0.2) trendIcon = '<span style="color:var(--score-3);font-size:1rem">↑</span>';
        else if (lateAvg < earlyAvg - 0.2) trendIcon = '<span style="color:var(--score-1);font-size:1rem">↓</span>';
        else trendIcon = '<span style="color:var(--text-3);font-size:1rem">→</span>';
      }
      html += '<td class="gb-summary" style="text-align:center">' + trendIcon + '</td></tr>';
    });

    // Stats row
    html += '<tr class="gb-stats-row"><th class="gb-name" scope="row">Class Average</th>';
    html += renderOverallStatsCell(cid, sortedStudents);
    if (isLetter) html += '<td class="gb-summary"></td>';
    columns.forEach(function(col) {
      var vals;
      if (col.type === 'group') {
        vals = sortedStudents.map(function(s) { return getGroupProficiency(cid, s.id, col.group.id); }).filter(function(v) { return v > 0; });
      } else {
        vals = sortedStudents.map(function(s) { return getSectionProficiency(cid, s.id, col.section.id); }).filter(function(v) { return v > 0; });
      }
      if (!vals.length) html += '<td class="gb-summary"><span class="gb-summary-val" style="color:var(--text-3)">—</span></td>';
      else { var avg = vals.reduce(function(a,b){return a+b;},0)/vals.length; var ar = Math.round(avg); html += '<td class="gb-summary" style="background:linear-gradient(' + PROF_TINT[ar] + ',' + PROF_TINT[ar] + '),var(--surface)"><span class="gb-summary-val" style="color:' + PROF_COLORS[ar] + '">' + avg.toFixed(1) + '</span></td>'; }
    });
    var cvgVals = sortedStudents.map(function(s) { return getCompletionPct(cid, s.id); });
    var cvgAvg = cvgVals.length > 0 ? Math.round(cvgVals.reduce(function(a,b){return a+b;},0)/cvgVals.length) : 0;
    html += '<td class="gb-summary" style="text-align:center"><span class="gb-summary-val" style="color:' + (cvgAvg>=75?'var(--score-3)':cvgAvg>=50?'var(--score-2)':'var(--score-1)') + '">' + cvgAvg + '%</span></td>';
    html += '<td class="gb-summary"></td></tr>';
    html += '</tbody></table></div></div>';
    return html;
  }

  /* ── Always-visible Overall column ──────────────────────── */
  function renderOverallHeader(rowspan) {
    var rs = rowspan ? ' rowspan="' + rowspan + '"' : '';
    return '<th class="gb-overall-col-header gb-sortable"' + rs + ' data-action="toggleSort" data-sortkey="overall">Overall' + sortArrow('overall') + '</th>';
  }
  function renderOverallCell(cid, sid) {
    var val = getOverallProficiency(cid, sid);
    var r = Math.round(val);
    var color = PROF_COLORS[r] || PROF_COLORS[0];
    var label = val > 0 ? PROF_LABELS[r] : '';
    var num = val > 0 ? val.toFixed(1) : '—';
    var tint = PROF_TINT[r] || '';
    var bg = tint ? 'background:linear-gradient(' + tint + ',' + tint + '),var(--bg)' : '';
    return '<td class="gb-overall-col"' + (bg ? ' style="' + bg + '"' : '') + '><span class="gb-overall-num" style="color:' + color + '">' + num + '</span>' + (label ? '<div class="gb-overall-label" style="color:' + color + '">' + label + '</div>' : '') + '</td>';
  }
  function renderOverallStatsCell(cid, students) {
    var vals = students.map(function(s) { return getOverallProficiency(cid, s.id); }).filter(function(v) { return v > 0; });
    if (!vals.length) return '<td class="gb-overall-col"><span class="gb-overall-num" style="color:var(--text-3)">—</span></td>';
    var avg = vals.reduce(function(a,b){return a+b;},0)/vals.length;
    var r = Math.round(avg);
    var tint = PROF_TINT[r] || '';
    var bg = tint ? 'background:linear-gradient(' + tint + ',' + tint + '),var(--bg)' : '';
    return '<td class="gb-overall-col"' + (bg ? ' style="' + bg + '"' : '') + '><span class="gb-overall-num" style="color:' + PROF_COLORS[r] + '">' + avg.toFixed(1) + '</span><div class="gb-overall-label" style="color:' + PROF_COLORS[r] + '">' + (PROF_LABELS[r]||'') + '</div></td>';
  }

  function renderNameCell(cid, student, sections, isLetter) {
    var overall = getOverallProficiency(cid, student.id);
    var or2 = Math.round(overall);
    var oLabel = overall > 0 ? PROF_LABELS[or2] : 'No Evidence';
    var oColor = PROF_COLORS[or2] || PROF_COLORS[0];
    var pctV = getCompletionPct(cid, student.id);
    var tip = '<div class="gb-tip-row"><span class="gb-tip-label">Overall</span><span class="gb-tip-val" style="color:' + oColor + '">' + oLabel + (overall>0?' ('+overall.toFixed(1)+')':'') + '</span></div>';
    sections.forEach(function(sec) {
      var sp = getSectionProficiency(cid, student.id, sec.id);
      var sr = Math.round(sp); var sc = PROF_COLORS[sr]||PROF_COLORS[0];
      tip += '<div class="gb-tip-row"><span class="gb-tip-label">' + esc(sec.shortName||sec.name) + '</span><span class="gb-tip-val" style="color:' + sc + '">' + (sp>0?sp.toFixed(1):'—') + '</span></div>';
    });
    if (isLetter && overall > 0) { var lg = calcLetterGrade(overall); tip += '<div class="gb-tip-row"><span class="gb-tip-label">Grade</span><span class="gb-tip-val">' + lg.letter + ' (' + lg.pct + '%)</span></div>'; }
    tip += '<div class="gb-tip-row"><span class="gb-tip-label">Coverage</span><span class="gb-tip-val">' + pctV + '%</span></div>';
    return '<div class="gb-name-wrap" data-tip="' + esc(tip) + '"><a href="#/student?id=' + student.id + '&course=' + cid + '">' + esc(displayName(student)) + '</a></div>';
  }

  function renderSummaryCell(cid, sid, sc) {
    var display, tint = '';
    if (sc.type === 'section') {
      var val = getSectionProficiency(cid, sid, sc.section.id); var r = Math.round(val); var color = PROF_COLORS[r]||PROF_COLORS[0];
      tint = PROF_TINT[r] || '';
      display = val > 0 ? '<span class="gb-summary-val" style="color:' + color + '">' + val.toFixed(1) + '</span>' : '<span class="gb-summary-val" style="color:var(--text-3)">—</span>';
    } else if (sc.type === 'grade') {
      var val = getOverallProficiency(cid, sid);
      if (val > 0) { var g = calcLetterGrade(val); display = '<span class="gb-summary-val" style="color:var(--text)">' + g.letter + ' (' + g.pct + '%)</span>'; }
      else display = '<span class="gb-summary-val" style="color:var(--text-3)">—</span>';
    }
    var bg = tint ? ' style="background:linear-gradient(' + tint + ',' + tint + '),var(--surface)"' : '';
    return '<td class="gb-summary"' + (sc.type==='section'?' data-secid="'+sc.section.id+'"':'') + bg + '>' + display + '</td>';
  }

  function renderClassStatsRow(cid, students, cols, groups, sections, scores) {
    var html = '<tr class="gb-stats-row"><th class="gb-name" scope="row">Class Average</th>';
    html += renderOverallStatsCell(cid, students);
    var colGroupMap = cols.map(function(_, i) { return groups.find(function(g) { return i >= g.startIdx && i < g.startIdx + g.count; }); });
    cols.forEach(function(col, i) {
      var g = colGroupMap[i];
      var startClass = (g && g.groupIdx > 0 && g.startIdx === i) ? ' gb-group-start' : '';
      var altClass = (g && g.groupIdx % 2 === 1) ? ' gb-group-alt' : '';
      var vals = students.map(function(s) { var ss = scores[s.id]||[]; var entry = ss.find(function(e) { return e.assessmentId === col.assessmentId && e.tagId === col.tagId; }); return entry && entry.score > 0 ? entry.score : null; }).filter(function(v) { return v !== null; });
      if (!vals.length) html += '<td class="gb-score' + startClass + altClass + '" style="cursor:default"><span class="gb-score-val s0" style="background:transparent">—</span></td>';
      else { var avg = vals.reduce(function(a,b){return a+b;},0)/vals.length; var r = Math.round(avg); html += '<td class="gb-score' + startClass + altClass + '" style="cursor:default"><span class="gb-avg-val" style="color:' + PROF_COLORS[r] + ';font-weight:700">' + avg.toFixed(1) + '</span></td>'; }
    });
    html += '</tr>';
    return html;
  }

  /* ── Sorting ─────────────────────────────────────────────── */
  function applySorting(cid, students, sections, isLetter) {
    if (!sortCol) return students;
    var key = sortCol.key; var dir = sortCol.dir === 'asc' ? 1 : -1;
    return students.slice().sort(function(a, b) {
      var va, vb;
      if (key === 'name') {
        va = (a.lastName||'').toLowerCase() + ' ' + (a.firstName||'').toLowerCase(); vb = (b.lastName||'').toLowerCase() + ' ' + (b.firstName||'').toLowerCase();
        return va < vb ? -dir : va > vb ? dir : 0;
      } else if (key === 'overall') { va = getOverallProficiency(cid, a.id); vb = getOverallProficiency(cid, b.id); }
      else if (key === 'coverage') { va = getCompletionPct(cid, a.id); vb = getCompletionPct(cid, b.id); }
      else if (key.startsWith('grp-')) { var grpId = key.slice(4); va = getGroupProficiency(cid, a.id, grpId); vb = getGroupProficiency(cid, b.id, grpId); }
      else if (key.startsWith('sec-')) { var secId = key.slice(4); va = getSectionProficiency(cid, a.id, secId); vb = getSectionProficiency(cid, b.id, secId); }
      else if (key.startsWith('avg-')) {
        var aid = key.slice(4); var sc = getScores(cid); var assess = getAssessments(cid).find(function(a) { return a.id === aid; }); var tagIds = assess ? (assess.tagIds||[]) : [];
        var getAvg = function(sid) { var ss = sc[sid]||[]; var ts = tagIds.map(function(tid) { var e = ss.find(function(e) { return e.assessmentId===aid && e.tagId===tid; }); return e?e.score:0; }).filter(function(v){return v>0;}); return ts.length > 0 ? ts.reduce(function(x,y){return x+y;},0)/ts.length : 0; };
        va = getAvg(a.id); vb = getAvg(b.id);
      } else { va = getOverallProficiency(cid, a.id); vb = getOverallProficiency(cid, b.id); }
      return (va - vb) * dir;
    });
  }

  /* ── Score cycling ──────────────────────────────────────── */
  var seq = [3, 4, 0, 1, 2];
  function cycleScore(td) {
    var cid = activeCourse; var aid = td.dataset.aid; var tid = td.dataset.tid; var sid = td.dataset.sid;
    var assess = getAssessments(cid).find(function(a) { return a.id === aid; });
    if (assess && assess.scoreMode === 'points') { showPointsInput(td, assess); return; }
    var scores = getScores(cid); if (!scores[sid]) scores[sid] = [];
    var entry = scores[sid].find(function(e) { return e.assessmentId === aid && e.tagId === tid; });
    var current = entry ? entry.score : 0;
    var next = seq[(seq.indexOf(current) + 1) % seq.length];
    if (entry) entry.score = next;
    else { scores[sid].push({ id: uid(), assessmentId: aid, tagId: tid, score: next, date: assess ? assess.date : new Date().toISOString().slice(0,10), type: assess ? assess.type : 'summative', note: '', created: new Date().toISOString() }); }
    saveScores(cid, scores);
    var span = td.querySelector('.gb-score-val');
    span.className = 'gb-score-val s' + next;
    if (next > 0) { span.textContent = next; }
    else { span.innerHTML = '<span class="gb-unscored">·</span>'; }
    updateRowSummary(cid, sid, td.closest('tr'));
    refreshSidebar();
  }

  /* ── Points-mode inline input ──────────────────────────── */
  function showPointsInput(td, assess) {
    if (td.querySelector('.gb-pts-input')) return;
    var cid = activeCourse; var aid = td.dataset.aid; var sid = td.dataset.sid;
    var isPtsCol = td.dataset.pts === '1';
    var max = assess.maxPoints || 100;
    var current = isPtsCol ? getPointsScore(cid, sid, aid) : (function() {
      var scores = getScores(cid); var entries = scores[sid] || [];
      var e = entries.find(function(e) { return e.assessmentId === aid && e.tagId === td.dataset.tid; });
      return e ? e.score : 0;
    })();
    var existing = td.querySelector('.gb-pts-display') || td.querySelector('.gb-pts-empty');
    if (existing) existing.style.display = 'none';
    var wrap = document.createElement('div');
    wrap.className = 'gb-pts-input-wrap';
    var inp = document.createElement('input');
    inp.type = 'number'; inp.min = '0'; inp.max = String(max);
    inp.inputMode = 'numeric';
    inp.value = current > 0 ? current : '';
    inp.className = 'gb-pts-input';
    var pctLabel = document.createElement('span');
    pctLabel.className = 'gb-pts-live-pct';
    pctLabel.textContent = current > 0 ? Math.round(current / max * 100) + '%' : '';
    wrap.appendChild(inp);
    wrap.appendChild(pctLabel);
    td.appendChild(wrap);
    inp.focus(); inp.select();
    inp.addEventListener('input', function() {
      var v = parseInt(inp.value, 10);
      pctLabel.textContent = (!isNaN(v) && v >= 0) ? Math.round(Math.min(v, max) / max * 100) + '%' : '';
    });
    function commit() {
      var val = parseInt(inp.value, 10);
      var raw = isNaN(val) ? 0 : Math.max(0, Math.min(max, val));
      if (isPtsCol) {
        setPointsScore(cid, sid, aid, raw);
      } else {
        var tidVal = td.dataset.tid;
        var scores = getScores(cid); if (!scores[sid]) scores[sid] = [];
        var entry = scores[sid].find(function(e) { return e.assessmentId === aid && e.tagId === tidVal; });
        if (entry) entry.score = raw;
        else if (raw > 0) { scores[sid].push({ id: uid(), assessmentId: aid, tagId: tidVal, score: raw, date: assess.date || new Date().toISOString().slice(0,10), type: assess.type || 'summative', note: '', created: new Date().toISOString() }); }
        saveScores(cid, scores);
      }
      wrap.remove();
      if (existing) existing.remove();
      if (raw > 0) {
        var pctV = Math.round(raw / max * 100);
        td.innerHTML = '<div class="gb-pts-display"><span class="gb-pts-score">' + raw + '<span class="gb-pts-max">/' + max + '</span></span><span class="gb-pts-pct">' + pctV + '%</span></div>';
        td.title = raw + '/' + max + ' (' + pctV + '%)';
      } else {
        td.innerHTML = '<span class="gb-pts-empty">·</span>';
        td.title = '';
      }
      updateRowSummary(cid, sid, td.closest('tr'));
      refreshSidebar();
    }
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { wrap.remove(); if (existing) existing.style.display = ''; }
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
    var today = new Date().toISOString().slice(0, 10);

    var pop = document.createElement('div');
    pop.className = 'gb-add-popover';
    pop.innerHTML =
      '<div class="gb-add-popover-title">New Assignment</div>' +
      '<div class="gb-add-field"><label>Title</label><input type="text" id="gb-new-title" placeholder="e.g. Chapter 3 Quiz" autofocus></div>' +
      '<div class="gb-add-row">' +
        '<div class="gb-add-field"><label>Date</label><input type="date" id="gb-new-date" value="' + today + '"></div>' +
        '<div class="gb-add-field"><label>Type</label><select id="gb-new-type"><option value="summative">Summative</option><option value="formative">Formative</option></select></div>' +
      '</div>' +
      '<div class="gb-add-row">' +
        '<div class="gb-add-field"><label>Score Mode</label><select id="gb-new-scoremode"><option value="proficiency">Proficiency (1-4)</option><option value="points">Points</option></select></div>' +
        '<div class="gb-add-field" id="gb-new-pts-wrap" style="display:none"><label>Max Points</label><input type="number" id="gb-new-maxpts" value="100" min="1"></div>' +
      '</div>' +
      '<div class="gb-add-field"><label>Standards <span style="font-weight:400;color:var(--text-3)">(select at least one)</span></label>' +
        '<div class="gb-add-tags">' + sections.map(function(sec) {
          return '<label class="gb-add-tag"><input type="checkbox" value="' + (sec.tags[0] ? sec.tags[0].id : sec.id) + '" checked>' +
            '<span style="color:' + sec.color + '">' + esc(sec.shortName || sec.name) + '</span></label>';
        }).join('') + '</div>' +
      '</div>' +
      '<div class="gb-add-actions">' +
        '<button class="gb-add-cancel" data-action="cancelAddAssess">Cancel</button>' +
        '<button class="gb-add-confirm" data-action="confirmAddAssess">Create</button>' +
      '</div>';
    document.body.appendChild(pop);

    // Show/hide points field
    var smSel = pop.querySelector('#gb-new-scoremode');
    smSel.addEventListener('change', function() {
      pop.querySelector('#gb-new-pts-wrap').style.display = smSel.value === 'points' ? '' : 'none';
    });

    // Position near button
    var rect = anchor.getBoundingClientRect();
    pop.style.top = (rect.bottom + 8) + 'px';
    pop.style.right = (window.innerWidth - rect.right) + 'px';

    // Close on outside click (after a tick)
    setTimeout(function() {
      document.addEventListener('mousedown', function handler(ev) {
        if (!pop.contains(ev.target) && ev.target !== anchor) {
          dismissAddAssessPopover();
          document.removeEventListener('mousedown', handler);
        }
      });
    }, 0);

    // Focus title
    setTimeout(function() { var t = pop.querySelector('#gb-new-title'); if (t) t.focus(); }, 50);
  }

  function confirmAddAssess() {
    var cid = activeCourse;
    var title = (document.getElementById('gb-new-title') || {}).value;
    if (!title || !title.trim()) {
      var el = document.getElementById('gb-new-title');
      if (el) { el.style.border = '2px solid var(--score-1)'; el.focus(); }
      return;
    }
    var date = (document.getElementById('gb-new-date') || {}).value || new Date().toISOString().slice(0, 10);
    var type = (document.getElementById('gb-new-type') || {}).value || 'summative';
    var scoreMode = (document.getElementById('gb-new-scoremode') || {}).value || 'proficiency';
    var maxPoints = parseInt((document.getElementById('gb-new-maxpts') || {}).value, 10) || 100;
    var tagIds = Array.from(document.querySelectorAll('.gb-add-tag input:checked')).map(function(cb) { return cb.value; });
    if (tagIds.length === 0) return;

    var assessments = getAssessments(cid);
    var newAssess = {
      id: uid(),
      title: title.trim(),
      date: date,
      dateAssigned: date,
      type: type,
      tagIds: tagIds,
      notes: '',
      created: new Date().toISOString()
    };
    if (scoreMode === 'points') { newAssess.scoreMode = 'points'; newAssess.maxPoints = maxPoints; }
    assessments.push(newAssess);
    saveAssessments(cid, assessments);
    dismissAddAssessPopover();
    render();
  }

  /* ── Scores tab: CSV export ─────────────────────────────── */
  function exportScoresCSV() {
    var cid = activeCourse;
    var students = sortStudents(getStudents(cid), 'lastName');
    var assessments = getAssessments(cid).slice().sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var sections = getSections(cid);
    var scores = getScores(cid);
    var grouped = getGroupedSections(cid);
    var hasGroups = grouped.groups.some(function(g) { return g.sections.length > 0; });

    // Build header
    var headers = ['Student'];
    if (hasGroups) {
      grouped.groups.forEach(function(gi) { if (gi.sections.length > 0) headers.push(gi.group.name + ' (Group Avg)'); });
    }
    sections.forEach(function(sec) { headers.push(sec.shortName || sec.name); });
    headers.push('Overall', 'Final %');
    assessments.forEach(function(a) { headers.push(a.title + ' (' + (a.date || '') + ')'); });

    var rows = [headers];
    students.forEach(function(s) {
      var row = [fullName(s)];
      // Group averages
      if (hasGroups) {
        grouped.groups.forEach(function(gi) {
          if (gi.sections.length === 0) return;
          var gp = getGroupProficiency(cid, s.id, gi.group.id);
          row.push(gp > 0 ? gp.toFixed(2) : '');
        });
      }
      // Individual sections
      sections.forEach(function(sec) {
        var sp = getSectionProficiency(cid, s.id, sec.id);
        row.push(sp > 0 ? sp.toFixed(2) : '');
      });
      // Overall + final %
      var overall = getOverallProficiency(cid, s.id);
      row.push(overall > 0 ? overall.toFixed(2) : '');
      row.push(overall > 0 ? Math.round(overall / 4 * 100) + '%' : '');
      // Assessment scores
      assessments.forEach(function(a) {
        var ss = scores[s.id] || [];
        var tagScores = (a.tagIds || []).map(function(tid) {
          var e = ss.find(function(e) { return e.assessmentId === a.id && e.tagId === tid; });
          return e ? e.score : 0;
        }).filter(function(v) { return v > 0; });
        var avg = tagScores.length > 0 ? tagScores.reduce(function(x, y) { return x + y; }, 0) / tagScores.length : 0;
        row.push(avg > 0 ? avg.toFixed(1) : '');
      });
      rows.push(row);
    });

    var csv = rows.map(function(r) { return r.map(function(c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = (COURSES[cid] ? COURSES[cid].name : 'gradebook') + '_scores.csv';
    a.click(); URL.revokeObjectURL(url);
  }

  /* ── Scores tab: context menus ──────────────────────────── */
  function _dismissContextMenu() {
    var existing = document.querySelector('.gb-ctx-menu');
    if (existing) existing.remove();
  }

  function showScoreContextMenu(e, cell) {
    _dismissContextMenu();
    var aid = cell.dataset.aid; var sid = cell.dataset.sid;
    var menu = document.createElement('div');
    menu.className = 'gb-ctx-menu';
    menu.style.left = e.clientX + 'px'; menu.style.top = e.clientY + 'px';
    menu.innerHTML =
      '<div class="gb-ctx-item" data-ctx="editCell">Edit Score</div>' +
      '<div class="gb-ctx-item" data-ctx="clearCell">Clear Score</div>' +
      '<div class="gb-ctx-divider"></div>' +
      '<div class="gb-ctx-item" data-ctx="markMissing">Mark Missing</div>' +
      '<div class="gb-ctx-item" data-ctx="excuseCell">Excuse</div>';
    document.body.appendChild(menu);
    menu.addEventListener('click', function(ev) {
      var item = ev.target.closest('[data-ctx]');
      if (!item) return;
      var action = item.dataset.ctx;
      if (action === 'editCell') startCellEdit(cell);
      else if (action === 'clearCell') {
        var cid = activeCourse; var scores = getScores(cid);
        var assess = getAssessments(cid).find(function(a) { return a.id === aid; });
        if (assess && scores[sid]) {
          (assess.tagIds || []).forEach(function(tid) {
            var idx = scores[sid].findIndex(function(e) { return e.assessmentId === aid && e.tagId === tid; });
            if (idx >= 0) scores[sid].splice(idx, 1);
          });
          saveScores(cid, scores); clearProfCache(); render();
        }
      }
      _dismissContextMenu();
    });
    setTimeout(function() { document.addEventListener('click', _dismissContextMenu, { once: true }); }, 0);
  }

  function showHeaderContextMenu(e, header) {
    _dismissContextMenu();
    var aid = header.dataset.aid;
    var menu = document.createElement('div');
    menu.className = 'gb-ctx-menu';
    menu.style.left = e.clientX + 'px'; menu.style.top = e.clientY + 'px';
    var assess = getAssessments(activeCourse).find(function(a) { return a.id === aid; });
    var _cc = getCourseConfig(activeCourse);
    var currentPolicy = (assess && assess.missingPolicy) || _cc.missingPolicy || 'exclude';
    menu.innerHTML =
      '<div class="gb-ctx-item" data-ctx="scoreMode">Score This Assignment</div>' +
      '<div class="gb-ctx-item" data-ctx="editAssess">Edit Assignment Details</div>' +
      '<div class="gb-ctx-divider"></div>' +
      '<div class="gb-ctx-item" data-ctx="toggleZeroPolicy">' + (currentPolicy === 'zero' ? '\u2713 ' : '') + 'Count missing as zero</div>' +
      '<div class="gb-ctx-divider"></div>' +
      '<div class="gb-ctx-item gb-ctx-danger" data-ctx="deleteAssess">Delete Assignment</div>';
    document.body.appendChild(menu);
    menu.addEventListener('click', function(ev) {
      var item = ev.target.closest('[data-ctx]');
      if (!item) return;
      var action = item.dataset.ctx;
      if (action === 'scoreMode') enterScoreMode(aid);
      else if (action === 'editAssess') Router.navigate('#/assignments?course=' + activeCourse + '&open=' + aid);
      else if (action === 'toggleZeroPolicy') {
        var assessList = getAssessments(activeCourse);
        var a = assessList.find(function(x) { return x.id === aid; });
        if (a) {
          a.missingPolicy = (a.missingPolicy === 'zero') ? 'exclude' : 'zero';
          saveAssessments(activeCourse, assessList);
          render();
        }
      }
      else if (action === 'deleteAssess') {
        if (confirm('Delete this assignment and all its scores?')) {
          var cid = activeCourse;
          var assessments = getAssessments(cid).filter(function(a) { return a.id !== aid; });
          saveAssessments(cid, assessments);
          var scores = getScores(cid);
          Object.keys(scores).forEach(function(sid) {
            scores[sid] = scores[sid].filter(function(e) { return e.assessmentId !== aid; });
          });
          saveScores(cid, scores); clearProfCache(); render();
        }
      }
      _dismissContextMenu();
    });
    setTimeout(function() { document.addEventListener('click', _dismissContextMenu, { once: true }); }, 0);
  }

  /* ── Scores tab: column-focus score mode ────────────────── */
  function enterScoreMode(assessmentId) {
    _scoreMode = { assessmentId: assessmentId, studentIdx: 0 };
    render();
    // After render, auto-focus the first cell in this column
    setTimeout(function() {
      var firstCell = document.querySelector('.gb-scores-cell.gb-scores-focus');
      if (firstCell) startCellEdit(firstCell);
    }, 50);
  }

  function advanceScoreMode() {
    if (!_scoreMode) return;
    _scoreMode.studentIdx++;
    // Check if we've passed the last student
    var sortedStudents = applySorting(activeCourse, sortStudents(getStudents(activeCourse), 'lastName'), getSections(activeCourse), false);
    if (_scoreMode.studentIdx >= sortedStudents.length) {
      _scoreMode = null;
      render();
      return;
    }
    render();
    setTimeout(function() {
      // After render, exactly one cell has gb-scores-focus
      var target = document.querySelector('.gb-scores-cell.gb-scores-focus');
      if (target) startCellEdit(target);
      else { _scoreMode = null; render(); }
    }, 50);
  }

  /* ── Scores tab: inline cell editing ────────────────────── */
  function startCellEdit(td) {
    if (td.querySelector('.gb-scores-input')) return;
    var cid = activeCourse;
    var aid = td.dataset.aid; var sid = td.dataset.sid;
    var assess = getAssessments(cid).find(function(a) { return a.id === aid; });
    if (!assess) return;
    var tagIds = assess.tagIds || [];
    var studentScores = getScores(cid)[sid] || [];
    // Get current average for display
    var tagScores = tagIds.map(function(tid) {
      var e = studentScores.find(function(e) { return e.assessmentId === aid && e.tagId === tid; });
      return e ? e.score : 0;
    }).filter(function(v) { return v > 0; });
    var currentVal = tagScores.length > 0 ? tagScores.reduce(function(a, b) { return a + b; }, 0) / tagScores.length : 0;

    var span = td.querySelector('.gb-scores-val');
    if (span) span.style.display = 'none';
    var inp = document.createElement('input');
    inp.type = 'number'; inp.step = '0.1'; inp.min = '0'; inp.max = '4';
    inp.className = 'gb-scores-input';
    inp.value = currentVal > 0 ? currentVal.toFixed(1) : '';
    td.appendChild(inp);
    inp.focus(); inp.select();

    function commit(navDir) {
      var val = parseFloat(inp.value);
      if (inp.value === '' || isNaN(val)) val = 0;
      // Save undo
      // Save full entries for undo (deep copy)
      var prevEntries = tagIds.map(function(tid) {
        var e = (getScores(cid)[sid] || []).find(function(e) { return e.assessmentId === aid && e.tagId === tid; });
        return e ? JSON.parse(JSON.stringify(e)) : null;
      });
      _undoStack.push({ cid: cid, sid: sid, aid: aid, tagIds: tagIds, prevEntries: prevEntries });
      // Apply score to all tags in this assessment
      var allScores = getScores(cid);
      if (!allScores[sid]) allScores[sid] = [];
      tagIds.forEach(function(tid) {
        var entry = allScores[sid].find(function(e) { return e.assessmentId === aid && e.tagId === tid; });
        if (entry) { entry.score = val; }
        else if (val > 0) {
          allScores[sid].push({ id: uid(), assessmentId: aid, tagId: tid, score: val, date: assess.date || new Date().toISOString().slice(0,10), type: assess.type || 'summative', note: '', created: new Date().toISOString() });
        }
      });
      saveScores(cid, allScores);
      clearProfCache();
      inp.remove();
      if (span) span.style.display = '';
      if (_scoreMode) { advanceScoreMode(); return; }
      // Navigate to adjacent cell
      if (navDir) {
        // Capture data attributes BEFORE re-render destroys DOM
        var row = td.closest('tr');
        var cells = Array.from(row.querySelectorAll('.gb-scores-cell'));
        var colIdx = cells.indexOf(td);
        var rows = Array.from(document.querySelectorAll('.gb-scores-row'));
        var rowIdx = rows.indexOf(row);
        var targetAid = null, targetSid = null;
        if (navDir === 'right' && colIdx < cells.length - 1) {
          targetAid = cells[colIdx + 1].dataset.aid; targetSid = cells[colIdx + 1].dataset.sid;
        } else if (navDir === 'left' && colIdx > 0) {
          targetAid = cells[colIdx - 1].dataset.aid; targetSid = cells[colIdx - 1].dataset.sid;
        } else if (navDir === 'down' && rowIdx < rows.length - 1) {
          var nextCells = rows[rowIdx + 1].querySelectorAll('.gb-scores-cell');
          if (nextCells[colIdx]) { targetAid = nextCells[colIdx].dataset.aid; targetSid = nextCells[colIdx].dataset.sid; }
        }
        if (targetAid && targetSid) {
          render();
          setTimeout(function() {
            var newCell = document.querySelector('.gb-scores-cell[data-aid="' + targetAid + '"][data-sid="' + targetSid + '"]');
            if (newCell) startCellEdit(newCell);
          }, 30);
          return;
        }
      }
      render();
    }

    var _navDir = null; // 'down' | 'right' | null
    inp.addEventListener('blur', function() { commit(_navDir); });
    inp.addEventListener('keydown', function(ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); _navDir = 'down'; inp.blur(); }
      else if (ev.key === 'Tab') { ev.preventDefault(); _navDir = ev.shiftKey ? 'left' : 'right'; inp.blur(); }
      else if (ev.key === 'Escape') { inp.remove(); if (span) span.style.display = ''; _scoreMode = null; }
    });
  }

  /* ── Update row summaries ───────────────────────────────── */
  function updateRowSummary(cid, sid, row) {
    var overallTd = row.querySelector('td.gb-overall-col');
    if (overallTd) {
      var val = getOverallProficiency(cid, sid);
      var r = Math.round(val);
      var color = PROF_COLORS[r] || PROF_COLORS[0];
      var label = val > 0 ? PROF_LABELS[r] : '';
      var num = val > 0 ? val.toFixed(1) : '—';
      var tint = PROF_TINT[r] || '';
      var bg = tint ? 'background:linear-gradient(' + tint + ',' + tint + '),var(--bg)' : '';
      overallTd.style.cssText = bg;
      overallTd.innerHTML = '<span class="gb-overall-num" style="color:' + color + '">' + num + '</span>' + (label ? '<div class="gb-overall-label" style="color:' + color + '">' + label + '</div>' : '');
    }
  }

  /* ── Keyboard Navigation ────────────────────────────────── */
  function kbAdvanceDown(table, focused) {
    var rows = table.querySelectorAll('tbody tr:not(.gb-stats-row)');
    var colsPerRow = rows[0] ? rows[0].querySelectorAll('td.gb-score').length : 0;
    if (colsPerRow === 0) return;
    var curRow = -1, curCol = -1;
    rows.forEach(function(r, ri) { r.querySelectorAll('td.gb-score').forEach(function(c, ci) { if (c === focused) { curRow = ri; curCol = ci; } }); });
    if (curRow < 0) return;
    var newRow = Math.min(curRow + 1, rows.length - 1);
    if (newRow === curRow) return;
    focused.classList.remove('gb-focus');
    var newCell = rows[newRow] ? rows[newRow].querySelectorAll('td.gb-score')[curCol] : null;
    if (newCell) { newCell.classList.add('gb-focus'); newCell.scrollIntoView({block:'nearest',inline:'nearest'}); }
  }

  function _handleKeydown(e) {
    // Cmd+Z undo for scores tab
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && viewMode === 'scores' && _undoStack.length > 0) {
      e.preventDefault();
      var undo = _undoStack.pop();
      var scores = getScores(undo.cid);
      if (!scores[undo.sid]) scores[undo.sid] = [];
      // Restore previous entries (full objects)
      (undo.tagIds || []).forEach(function(tid, i) {
        var prevEntry = undo.prevEntries[i];
        // Remove current entry for this tag
        var idx = scores[undo.sid].findIndex(function(e) { return e.assessmentId === undo.aid && e.tagId === tid; });
        if (idx >= 0) scores[undo.sid].splice(idx, 1);
        // Restore previous entry if it existed
        if (prevEntry) scores[undo.sid].push(prevEntry);
      });
      saveScores(undo.cid, scores);
      clearProfCache();
      render();
      return;
    }
    if (viewMode !== 'detailed') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    var table = document.querySelector('.gb-table'); if (!table) return;
    var rows = table.querySelectorAll('tbody tr:not(.gb-stats-row)');
    if (rows.length === 0) return;
    var colsPerRow = rows[0].querySelectorAll('td.gb-score').length;
    if (colsPerRow === 0) return;
    var focused = table.querySelector('.gb-focus');
    if (!focused && !['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Enter','Tab'].includes(e.key)) return;
    if (!focused && ['ArrowDown','ArrowRight','Tab'].includes(e.key)) {
      e.preventDefault();
      var first = rows[0] ? rows[0].querySelector('td.gb-score') : null;
      if (first) { first.classList.add('gb-focus'); first.scrollIntoView({block:'nearest',inline:'nearest'}); }
      return;
    }
    if (!focused) return;
    var curRow = -1, curCol = -1;
    rows.forEach(function(r, ri) { r.querySelectorAll('td.gb-score').forEach(function(c, ci) { if (c === focused) { curRow = ri; curCol = ci; } }); });
    if (curRow < 0) return;
    var newRow = curRow, newCol = curCol;
    if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); newCol++; if (newCol >= colsPerRow) { newCol = 0; newRow++; } if (newRow >= rows.length) { newRow = rows.length-1; newCol = colsPerRow-1; } }
    else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); newCol--; if (newCol < 0) { newCol = colsPerRow-1; newRow--; } if (newRow < 0) { newRow = 0; newCol = 0; } }
    else if (e.key === 'ArrowDown') { e.preventDefault(); newRow = Math.min(curRow+1, rows.length-1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); newRow = Math.max(curRow-1, 0); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focused.click(); return; }
    else if (e.key === 'Escape') { focused.classList.remove('gb-focus'); return; }
    else if (['1','2','3','4','5','6','7','8','9'].includes(e.key)) {
      var ptsAssess = focused.dataset.aid ? getAssessments(activeCourse).find(function(a) { return a.id === focused.dataset.aid; }) : null;
      if (ptsAssess && ptsAssess.scoreMode === 'points') { e.preventDefault(); showPointsInput(focused, ptsAssess); var pi = focused.querySelector('.gb-pts-input'); if (pi) { pi.value = e.key; pi.dispatchEvent(new Event('input')); } return; }
      if (!['1','2','3','4'].includes(e.key)) return;
      e.preventDefault();
      var val = parseInt(e.key, 10); var aid = focused.dataset.aid; var tid = focused.dataset.tid; var sid = focused.dataset.sid;
      if (aid && tid && sid) {
        var scores = getScores(activeCourse); if (!scores[sid]) scores[sid] = [];
        var entry = scores[sid].find(function(en) { return en.assessmentId === aid && en.tagId === tid; });
        if (entry) entry.score = val;
        else { var assess = getAssessments(activeCourse).find(function(a) { return a.id === aid; }); scores[sid].push({ id: uid(), assessmentId: aid, tagId: tid, score: val, date: assess?assess.date:new Date().toISOString().slice(0,10), type: assess?assess.type:'summative', note:'', created: new Date().toISOString() }); }
        saveScores(activeCourse, scores);
        var span = focused.querySelector('.gb-score-val');
        if (span) { span.className = 'gb-score-val s' + val; if (val > 0) { span.textContent = val; } else { span.innerHTML = '<span class="gb-unscored">·</span>'; } }
        updateRowSummary(activeCourse, sid, focused.closest('tr'));
        refreshSidebar();
      }
      kbAdvanceDown(table, focused);
      return;
    }
    else if (e.key === '0' || e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      var aid = focused.dataset.aid; var tid = focused.dataset.tid; var sid = focused.dataset.sid;
      if (aid && sid) {
        if (focused.dataset.pts === '1') {
          setPointsScore(activeCourse, sid, aid, 0);
        } else if (tid) {
          var scores = getScores(activeCourse); if (!scores[sid]) scores[sid] = [];
          var entry = scores[sid].find(function(en) { return en.assessmentId === aid && en.tagId === tid; });
          if (entry) entry.score = 0;
          saveScores(activeCourse, scores);
        }
        if (focused.classList.contains('gb-score-pts')) {
          focused.innerHTML = '<span class="gb-pts-empty">·</span>';
          focused.title = '';
        } else {
          var span = focused.querySelector('.gb-score-val');
          if (span) { span.className = 'gb-score-val s0'; span.innerHTML = '<span class="gb-unscored">·</span>'; }
        }
        updateRowSummary(activeCourse, sid, focused.closest('tr'));
        refreshSidebar();
      }
      return;
    } else return;
    focused.classList.remove('gb-focus');
    var newCell = rows[newRow] ? rows[newRow].querySelectorAll('td.gb-score')[newCol] : null;
    if (newCell) { newCell.classList.add('gb-focus'); newCell.scrollIntoView({block:'nearest',inline:'nearest'}); }
  }

  /* ── Tooltip ─────────────────────────────────────────────── */
  function _handleMouseover(e) {
    var gbTip = document.getElementById('gb-tooltip');
    if (!gbTip) return;
    var wrap = e.target.closest('.gb-name-wrap');
    if (wrap && wrap.dataset.tip) {
      gbTip.className = ''; gbTip.innerHTML = wrap.dataset.tip;
      gbTip.style.display = 'block'; _tipSource = wrap;
      var rect = wrap.getBoundingClientRect();
      var left = rect.right + 8;
      var top = rect.top + rect.height / 2 - gbTip.offsetHeight / 2;
      if (left + gbTip.offsetWidth > window.innerWidth - 12) { left = rect.left; top = rect.bottom + 6; }
      if (top < 8) top = 8;
      if (top + gbTip.offsetHeight > window.innerHeight - 8) top = window.innerHeight - gbTip.offsetHeight - 8;
      gbTip.style.left = left + 'px'; gbTip.style.top = top + 'px';
      return;
    }
    var tagTh = e.target.closest('.gb-tag-header');
    if (tagTh) {
      var tip = tagTh.querySelector('.gb-tag-tip');
      if (tip && tip.textContent.trim()) {
        gbTip.className = 'dark'; gbTip.textContent = tip.textContent.trim();
        gbTip.style.display = 'block'; _tipSource = tagTh;
        var rect = tagTh.getBoundingClientRect();
        var left = rect.left + rect.width / 2 - gbTip.offsetWidth / 2;
        var top = rect.top - gbTip.offsetHeight - 6;
        if (left < 8) left = 8;
        if (left + gbTip.offsetWidth > window.innerWidth - 8) left = window.innerWidth - gbTip.offsetWidth - 8;
        if (top < 8) { top = rect.bottom + 6; }
        gbTip.style.left = left + 'px'; gbTip.style.top = top + 'px';
      }
    }
  }

  function _handleMouseout(e) {
    if (_tipSource) {
      var related = e.relatedTarget;
      if (!related || !_tipSource.contains(related)) {
        var gbTip = document.getElementById('gb-tooltip');
        if (gbTip) { gbTip.style.display = 'none'; gbTip.className = ''; }
        _tipSource = null;
      }
    }
  }

  /* ── Delegated click handler ──────────────────────────────── */
  function _handleClick(e) {
    // Click-to-focus for score cells
    var td = e.target.closest('td.gb-score');
    var table = document.querySelector('.gb-table');
    if (td && table) {
      table.querySelectorAll('.gb-focus').forEach(function(el) { el.classList.remove('gb-focus'); });
      td.classList.add('gb-focus');
    } else if (table && !e.target.closest('td.gb-score')) {
      table.querySelectorAll('.gb-focus').forEach(function(el) { el.classList.remove('gb-focus'); });
    }

    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.dataset.action;
    if (el.dataset.stopProp === 'true') e.stopPropagation();
    var handlers = {
      'setView':              function() { setView(el.dataset.mode); },
      'toggleFilterStrip':    function() { toggleFilterStrip(); },
      'setTypeFilter':        function() { setTypeFilter(el.dataset.type); },
      'toggleSectionFilter':  function() { toggleSectionFilter(el.dataset.secid); },
      'toggleModuleFilter':   function() { toggleModuleFilter(el.dataset.moduleid); },
      'clearAllFilters':      function() { clearAllFilters(); },
      'toggleSort':           function() { toggleSort(el.dataset.sortkey); },
      'cycleScore':           function() { cycleScore(el); },
      'toggleDensity':        function() { _scoreDensity = _scoreDensity === 'compact' ? 'comfortable' : 'compact'; render(); },
      'increaseTextSize':     function() { _scoreTextSize = Math.min(20, _scoreTextSize + 1); render(); },
      'decreaseTextSize':     function() { _scoreTextSize = Math.max(9, _scoreTextSize - 1); render(); },
      'togglePin':            function() { var col = el.dataset.col; _pinnedCols[col] = !_pinnedCols[col]; render(); },
      'editScoreCell':        function() { startCellEdit(el); },
      'startScoreMode':       function() { enterScoreMode(el.dataset.aid); },
      'showAddAssessPopover': function() { showAddAssessPopover(el); },
      'confirmAddAssess':    function() { confirmAddAssess(); },
      'cancelAddAssess':     function() { dismissAddAssessPopover(); },
      'exportScoresCSV':      function() { exportScoresCSV(); },
      'stopPropOnly':         function() { /* just stop propagation */ }
    };
    if (handlers[action]) {
      if (action !== 'stopPropOnly' && action !== 'cycleScore' && el.tagName !== 'SELECT') e.preventDefault();
      handlers[action]();
    }
  }

  function _handleInput(e) {
    if (e.target.matches('[data-action-input="gbSearch"]')) {
      onSearch(e.target.value);
    }
  }

  function _handleChange(e) {
    if (e.target.matches('[data-action="switchCourse"]')) {
      switchCourse(e.target.value);
    }
  }

  /* ── init / destroy ─────────────────────────────────────── */
  function init(params) {
    activeCourse = params.course || getActiveCourse();
    setActiveCourse(activeCourse);
    viewMode = 'average';
    filterSections = [];
    filterModules = [];
    filterType = 'all';
    searchQuery = '';
    sortCol = null;
    _filterStripOpen = false;
    _tipSource = null;

    // No sidebar for gradebook
    document.getElementById('page-layout').classList.add('sidebar-hidden');
    document.getElementById('sidebar-mount').style.display = 'none';
    var _sidebarToggle = document.querySelector('[data-action="toggleSidebar"]');
    if (_sidebarToggle) _sidebarToggle.style.display = 'none';

    window._pageSwitchCourse = switchCourse;

    _addDocListener('click', _handleClick);
    _addDocListener('contextmenu', function(e) {
      // Scores tab context menus
      var cell = e.target.closest('.gb-scores-cell');
      if (cell) { e.preventDefault(); showScoreContextMenu(e, cell); return; }
      var header = e.target.closest('.gb-scores-assess-head');
      if (header) { e.preventDefault(); showHeaderContextMenu(e, header); return; }
    });
    _addDocListener('dblclick', function(e) {
      var el = e.target.closest('[data-action-dblclick]');
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

    render();

    requestAnimationFrame(function() { document.getElementById('main').scrollTop = 0; });
  }

  function destroy() {
    _listeners.forEach(function(l) {
      document.removeEventListener(l.type, l.handler, l.options);
    });
    _listeners = [];
    if (_scrollShadowCleanup) { _scrollShadowCleanup(); _scrollShadowCleanup = null; }
    var gbTip = document.getElementById('gb-tooltip');
    if (gbTip) { gbTip.style.display = 'none'; gbTip.className = ''; }
    _tipSource = null;
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
