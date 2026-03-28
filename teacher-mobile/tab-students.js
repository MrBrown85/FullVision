/* m-students.js — Feature 1: Student Quick-Look */

window.MStudents = (function() {
  'use strict';

  var MC = window.MComponents;
  var MAX_PROF = 4;
  var _viewMode = 'cards'; // 'cards' or 'list'

  /* ── Student List Screen ────────────────────────────────────── */
  function renderList(cid) {
    var students = getStudents(cid);
    students = sortStudents(students.slice(), 'alpha');

    var toggleHTML = '<div class="m-view-toggle">' +
      '<button class="m-view-toggle-btn' + (_viewMode === 'cards' ? ' active' : '') + '" data-action="m-set-view" data-mode="cards">Cards</button>' +
      '<button class="m-view-toggle-btn' + (_viewMode === 'list' ? ' active' : '') + '" data-action="m-set-view" data-mode="list">List</button>' +
    '</div>';

    var nav = MC.navBar({ id: 'students-list', title: 'Students', rightHTML:
      toggleHTML +
      '<button class="m-nav-bar-action" data-action="m-settings" title="Settings">' + MC.ICONS.settings + '</button>'
    });

    var search = '<div class="m-search-wrap"><input class="m-search-input" type="search" placeholder="Search students..." data-action="m-student-search" autocomplete="off"></div>';

    // Hoist course-level data outside loop (avoid N+1)
    var allStatuses = getAssignmentStatuses(cid);
    var allAssessments = getAssessments(cid);

    var cells = '';
    if (!students.length) {
      cells = '<div class="m-empty"><div class="m-empty-icon">👤</div><div class="m-empty-title">No Students</div><div class="m-empty-subtitle">Add students on the desktop app</div></div>';
    } else {
      cells = '<div class="m-list" id="m-student-list">';
      students.forEach(function(st) {
        var overall = getOverallProficiency(cid, st.id);
        var rounded = Math.round(overall);
        var color = MC.avatarColor(st.id);
        var initials = MC.avatarInitials(st);
        var name = displayName(st);
        var subtitle = '';
        if (st.pronouns) subtitle += MC.esc(st.pronouns);

        // Designation badges
        var badges = '';
        if (st.designations && st.designations.length) {
          st.designations.forEach(function(code) {
            var des = BC_DESIGNATIONS[code];
            if (des && des.iep) badges += ' <span class="m-badge m-badge-iep">IEP</span>';
            if (des && des.modified) badges += ' <span class="m-badge m-badge-mod">MOD</span>';
          });
        }

        // Missing work check
        var hasMissing = allAssessments.some(function(a) {
          return allStatuses[st.id + ':' + a.id] === 'NS';
        });
        var missingDot = hasMissing ? '<div class="m-missing-dot"></div>' : '';

        cells += '<div class="m-cell" role="button" tabindex="0" data-action="m-student-detail" data-sid="' + st.id + '">' +
          '<div class="m-cell-avatar" style="background:' + color + '">' + initials + missingDot + '</div>' +
          '<div class="m-cell-body">' +
            '<div class="m-cell-title">' + MC.esc(name) + badges + '</div>' +
            (subtitle ? '<div class="m-cell-subtitle">' + subtitle + '</div>' : '') +
          '</div>' +
          '<div class="m-cell-accessory">' +
            '<div class="m-prof-badge" style="background:' + MC.profBg(rounded) + '">' + (overall > 0 ? overall.toFixed(1) : '—') + '</div>' +
            MC.ICONS.chevronRight +
          '</div></div>';
      });
      cells += '</div>';
    }

    // Card stack mount (visual, populated by initCardStack after render)
    var cardStack = students.length
      ? '<div class="m-card-stack" id="m-student-card-stack"></div>'
      : '';

    return '<div class="m-screen" id="m-screen-students-list">' +
      nav +
      '<div class="m-screen-content">' +
        MC.largeTitleHTML('Students') +
        search + cardStack + cells +
      '</div></div>';
  }

  /* ── Rich Student Card (for card stack) ───────────────────── */
  function _renderStudentCard(st, cid, data) {
    var overall = getOverallProficiency(cid, st.id);
    var rounded = Math.round(overall);
    var color = MC.avatarColor(st.id);
    var initials = MC.avatarInitials(st);
    var name = displayName(st);

    // Badges
    var badges = '';
    if (st.designations && st.designations.length) {
      st.designations.forEach(function(code) {
        var des = BC_DESIGNATIONS[code];
        if (des && des.iep) badges += '<span class="m-badge m-badge-iep">IEP</span> ';
        if (des && des.modified) badges += '<span class="m-badge m-badge-mod">MOD</span> ';
      });
    }

    // Section mini-bars
    var sections = data.sections;
    var secBars = '';
    sections.forEach(function(sec) {
      var secProf = getSectionProficiency(cid, st.id, sec.id);
      var pct = Math.min(100, Math.round(secProf / MAX_PROF * 100));
      secBars += '<div class="m-scard-sec-row">' +
        '<div class="m-scard-sec-dot" style="background:' + (sec.color || '#888') + '"></div>' +
        '<div class="m-scard-sec-name">' + MC.esc(sec.shortName || sec.name) + '</div>' +
        '<div class="m-scard-sec-bar"><div class="m-scard-sec-fill" style="width:' + pct + '%;background:' + MC.profBg(Math.round(secProf)) + '"></div></div>' +
      '</div>';
    });

    // Latest observation
    var obs = getStudentQuickObs(cid, st.id);
    var obsSnippet = '';
    if (obs.length) {
      var latest = obs[0];
      var text = (latest.text || '').substring(0, 80);
      if (latest.text && latest.text.length > 80) text += '…';
      obsSnippet = '<div class="m-scard-obs">' +
        '<span style="color:var(--text-3);font-size:12px">' + MC.relativeTime(latest.created) + '</span> ' +
        MC.esc(text) +
      '</div>';
    } else {
      obsSnippet = '<div class="m-scard-obs-empty">No observations yet</div>';
    }

    return '<div class="m-scard">' +
      '<div class="m-scard-hero">' +
        '<div class="m-scard-avatar" style="background:' + color + '">' + initials + '</div>' +
        '<div class="m-scard-info">' +
          '<div class="m-scard-name">' + MC.esc(name) + '</div>' +
          (st.pronouns ? '<div class="m-scard-sub">' + MC.esc(st.pronouns) + '</div>' : '') +
          (badges ? '<div class="m-scard-badges">' + badges + '</div>' : '') +
        '</div>' +
        '<div class="m-scard-prof">' +
          '<div class="m-scard-prof-val" style="color:' + MC.profBg(rounded) + '">' + (overall > 0 ? overall.toFixed(1) : '—') + '</div>' +
          '<div class="m-scard-prof-label">' + (PROF_LABELS[rounded] || 'No Evidence') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="m-scard-sections">' + secBars + '</div>' +
      obsSnippet +
      '<div class="m-scard-actions">' +
        '<button class="m-scard-btn m-scard-btn-observe" data-action="m-obs-quick-menu" data-sid="' + st.id + '">Observe</button>' +
        '<button class="m-scard-btn m-scard-btn-view" data-action="m-student-detail" data-sid="' + st.id + '">View Profile</button>' +
      '</div>' +
    '</div>';
  }

  /* ── Init card stack after DOM render ─────────────────────── */
  var _stackInstance = null;

  function initCardStack(cid) {
    if (_stackInstance) { _stackInstance.destroy(); _stackInstance = null; }
    var container = document.getElementById('m-student-card-stack');
    var list = document.getElementById('m-student-list');

    // If in list mode, just show the list and skip card stack init
    if (_viewMode === 'list') {
      if (container) container.style.display = 'none';
      if (list) list.style.display = '';
      return;
    }

    if (!container) return;

    var students = getStudents(cid);
    students = sortStudents(students.slice(), 'alpha');
    if (!students.length) return;

    var sections = getSections(cid);
    var data = { sections: sections };

    _stackInstance = MCardStack.create(container, students, {
      renderCard: function(st) { return _renderStudentCard(st, cid, data); },
      onTap: function() { /* taps handled by data-action delegation */ },
      onSwipe: function() { /* no-op, browsing only */ }
    });

    if (container) container.style.display = '';
    if (list) list.style.display = 'none';
  }

  function setViewMode(mode) {
    _viewMode = mode;
    var container = document.getElementById('m-student-card-stack');
    var list = document.getElementById('m-student-list');

    // Update toggle buttons
    document.querySelectorAll('.m-view-toggle-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    if (mode === 'list') {
      // Switch to list
      if (_stackInstance) { _stackInstance.destroy(); _stackInstance = null; }
      if (container) container.style.display = 'none';
      if (list) {
        list.style.display = '';
        // Show all cells (clear any search filter)
        list.querySelectorAll('.m-cell').forEach(function(c) { c.style.display = ''; });
      }
    } else {
      // Switch to cards — re-init card stack
      // Find current cid from the screen's data or the global active course
      var cid = getActiveCourse();
      if (container) container.style.display = '';
      if (list) list.style.display = 'none';
      initCardStack(cid);
    }
  }

  function destroyCardStack() {
    if (_stackInstance) { _stackInstance.destroy(); _stackInstance = null; }
  }

  /* ── Student Detail Screen ──────────────────────────────────── */
  function renderDetail(cid, sid) {
    var students = getStudents(cid);
    var st = students.find(function(s) { return s.id === sid; });
    if (!st) return '<div class="m-screen"><div class="m-empty">Student not found</div></div>';

    var name = displayName(st);
    var color = MC.avatarColor(st.id);
    var initials = MC.avatarInitials(st);
    var overall = getOverallProficiency(cid, sid);
    var rounded = Math.round(overall);

    var nav = MC.navBar({ id: 'student-detail', title: name, backLabel: 'Students' });

    // Hero
    var badges = '';
    if (st.designations && st.designations.length) {
      st.designations.forEach(function(code) {
        var des = BC_DESIGNATIONS[code];
        if (des && des.iep) badges += '<span class="m-badge m-badge-iep">IEP</span>';
        if (des && des.modified) badges += '<span class="m-badge m-badge-mod">MOD</span>';
      });
    }

    var hero = '<div class="m-hero">' +
      '<div class="m-hero-avatar" style="background:' + color + '">' + initials + '</div>' +
      '<div class="m-hero-name">' + MC.esc(name) + '</div>' +
      (st.pronouns ? '<div class="m-hero-pronouns">' + MC.esc(st.pronouns) + '</div>' : '') +
      (badges ? '<div class="m-hero-badges">' + badges + '</div>' : '') +
      '<div class="m-hero-prof" style="background:' + MC.profBg(rounded) + '">' + (overall > 0 ? overall.toFixed(1) : '—') + '</div>' +
      '<div class="m-hero-prof-label">' + (PROF_LABELS[rounded] || 'No Evidence') + '</div>' +
    '</div>';

    // Stats strip
    var completionPct = getCompletionPct(cid, sid);
    var allTags = getAllTags(cid);
    var assessments = getAssessments(cid);
    var scores = getScores(cid)[sid] || [];
    var assessed = allTags.filter(function(t) {
      return scores.some(function(s) { return s.tagId === t.id && s.score > 0; });
    }).length;
    var statuses = getAssignmentStatuses(cid);
    var missingCount = assessments.filter(function(a) {
      return statuses[sid + ':' + a.id] === 'NS';
    }).length;
    var obsCount = getStudentQuickObs(cid, sid).length;

    var stats = '<div class="m-stats-strip">' +
      _statCard(overall > 0 ? overall.toFixed(1) : '—', 'Overall') +
      _statCard(Math.round(completionPct) + '%', 'Complete') +
      _statCard(assessed + '/' + allTags.length, 'Assessed') +
      (missingCount > 0 ? _statCard(missingCount, 'Missing', 'color:var(--priority)') : '') +
      _statCard(obsCount, 'Notes') +
    '</div>';

    // Focus areas (3 weakest tags)
    var focusAreas = getFocusAreas(cid, sid, 3);
    var focusHTML = '';
    var hasFocus = focusAreas.some(function(f) { return f.prof > 0 && f.prof < 3; }) || focusAreas.some(function(f) { return f.prof === 0; });
    if (hasFocus) {
      focusHTML = '<div class="m-list-inset-header">Focus Areas</div>';
      focusAreas.forEach(function(f) {
        var secColor = f.section ? f.section.color : '#888';
        var label = f.tag.label || f.tag.name || f.tag.id;
        focusHTML += '<div class="m-focus-row">' +
          '<span class="m-section-dot" style="background:' + secColor + '"></span>' +
          '<span class="m-focus-name">' + MC.esc(label) + '</span>' +
          '<span class="m-focus-prof" style="color:' + MC.profBg(Math.round(f.prof)) + '">' + (f.prof > 0 ? f.prof.toFixed(1) : 'No evidence') + '</span>' +
        '</div>';
      });
    }

    // Section proficiency cards (with competency groups)
    var grouped = getGroupedSections(cid);
    var sectionCards = '';

    function _renderSectionCard(sec) {
      var prof = getSectionProficiency(cid, sid, sec.id);
      var profRounded = Math.round(prof);
      var trend = getSectionTrend(cid, sid, sec.id);
      var trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '—';
      var trendColor = trend === 'up' ? 'var(--score-3)' : trend === 'down' ? 'var(--score-1)' : 'var(--text-3)';

      // Growth sparkline
      var growthData = getSectionGrowthData(cid, sid, sec.id);
      var sparkline = renderGrowthSparkline(growthData);

      // Tag details (hidden until expanded)
      var tagRows = '';
      sec.tags.forEach(function(tag) {
        var tagScores = getTagScores(cid, sid, tag.id);
        var tagProf = getTagProficiency(cid, sid, tag.id);
        var evCount = tagScores.filter(function(s) { return s.type === 'summative'; }).length;
        tagRows += '<div class="m-tag-row">' +
          '<span class="m-tag-name">' + MC.esc(tag.label || tag.name || tag.id) + '</span>' +
          '<span class="m-tag-score" style="color:' + MC.profBg(Math.round(tagProf)) + '">' + (tagProf > 0 ? tagProf.toFixed(1) : '—') + '</span>' +
          '<span class="m-tag-evidence">' + evCount + ' evidence</span>' +
        '</div>';
      });

      return '<div class="m-section-card" role="button" tabindex="0" aria-expanded="false" data-action="m-toggle-section" data-sec="' + sec.id + '">' +
        '<div class="m-section-header">' +
          '<div class="m-section-dot" style="background:' + (sec.color || '#888') + '"></div>' +
          '<div class="m-section-name">' + MC.esc(sec.shortName || sec.name) + '</div>' +
          sparkline +
          '<span class="m-section-trend" style="color:' + trendColor + '">' + trendIcon + '</span>' +
          '<span class="m-section-prof" style="color:' + MC.profBg(profRounded) + '">' + (prof > 0 ? prof.toFixed(1) : '—') + '</span>' +
        '</div>' +
        '<div class="m-section-detail">' + tagRows + '</div>' +
      '</div>';
    }

    // Render groups with headers
    if (grouped.groups.length) {
      grouped.groups.forEach(function(gi) {
        if (!gi.sections.length) return;
        var groupProf = getGroupProficiency(cid, sid, gi.group.id);
        var groupRounded = Math.round(groupProf);
        sectionCards += '<div class="m-group-header">' +
          '<span class="m-group-name">' + MC.esc(gi.group.label || gi.group.name) + '</span>' +
          '<span class="m-group-prof" style="color:' + MC.profBg(groupRounded) + '">' + (groupProf > 0 ? groupProf.toFixed(1) : '—') + '</span>' +
        '</div>';
        gi.sections.forEach(function(sec) { sectionCards += _renderSectionCard(sec); });
      });
      // Ungrouped sections
      if (grouped.ungrouped.length) {
        grouped.ungrouped.forEach(function(sec) { sectionCards += _renderSectionCard(sec); });
      }
    } else {
      // No groups — flat list (fallback)
      var sections = getSections(cid);
      sections.forEach(function(sec) { sectionCards += _renderSectionCard(sec); });
    }

    // Recent assessments
    var allScores = getScores(cid)[sid] || [];
    var recentAssess = assessments.slice().sort(function(a, b) {
      return b.date.localeCompare(a.date);
    }).slice(0, 5);

    var assessCards = '<div class="m-list-inset-header">Recent Assessments</div>';
    if (!recentAssess.length) {
      assessCards += '<div class="m-empty" style="padding:20px"><div class="m-empty-subtitle">No assessments yet</div></div>';
    } else {
      recentAssess.forEach(function(a) {
        var dateStr = new Date(a.date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
        var typeClass = a.type === 'summative' ? 'm-type-summative' : 'm-type-formative';
        var typeLabel = a.type === 'summative' ? 'S' : 'F';
        var status = statuses[sid + ':' + a.id];
        var statusBadge = '';
        if (status === 'NS') statusBadge = ' <span class="m-badge" style="background:var(--priority-light);color:var(--priority)">NS</span>';
        if (status === 'EXC') statusBadge = ' <span class="m-badge" style="background:var(--active-light);color:var(--active)">EXC</span>';

        // Score chips for each tag
        var scoreChips = '';
        (a.tagIds || []).forEach(function(tid) {
          var tag = getTagById(cid, tid);
          var tScores = allScores.filter(function(s) { return s.assessmentId === a.id && s.tagId === tid; });
          var latest = tScores.length ? tScores[tScores.length - 1] : null;
          var val = latest ? latest.score : null;
          var label = tag ? (tag.shortName || tag.label || tag.id) : tid;
          scoreChips += '<span class="m-assess-score-chip">' +
            '<span style="font-size:11px;color:var(--text-3)">' + MC.esc(label.substring(0, 8)) + '</span>' +
            '<span class="m-assess-score-val" style="color:' + MC.profBg(Math.round(val || 0)) + '">' + (val != null ? val.toFixed(1) : '—') + '</span>' +
          '</span>';
        });

        assessCards += '<div class="m-assess-compact">' +
          '<div class="m-assess-top">' +
            '<span class="m-type-badge ' + typeClass + '">' + typeLabel + '</span>' +
            '<span class="m-assess-title">' + MC.esc(a.title) + statusBadge + '</span>' +
            '<span class="m-assess-date">' + dateStr + '</span>' +
          '</div>' +
          (scoreChips ? '<div class="m-assess-scores">' + scoreChips + '</div>' : '') +
        '</div>';
      });
    }

    // Recent observations
    var obs = getStudentQuickObs(cid, sid).slice(-3).reverse();
    var obsCards = '<div class="m-list-inset-header">Recent Observations</div>';
    if (!obs.length) {
      obsCards += '<div class="m-empty" style="padding:20px"><div class="m-empty-subtitle">No observations yet</div></div>';
    } else {
      obs.forEach(function(ob) {
        var sentiment = OBS_SENTIMENTS[ob.sentiment] || {};
        var context = OBS_CONTEXTS[ob.context] || {};
        var tagChips = '';
        if (ob.dims && ob.dims.length) {
          ob.dims.forEach(function(dim) {
            var label = OBS_LABELS[dim] || dim;
            var icon = OBS_ICONS[dim] || '';
            tagChips += '<span class="m-obs-tag-chip">' + icon + ' ' + MC.esc(label) + '</span>';
          });
        }
        obsCards += '<div class="m-obs-card" data-sentiment="' + (ob.sentiment || '') + '">' +
          '<div class="m-obs-header">' +
            '<span class="m-obs-sentiment-icon">' + (sentiment.icon || '') + '</span>' +
            (context.label ? '<span class="m-obs-context">' + (context.icon || '') + ' ' + context.label + '</span>' : '') +
            '<span class="m-obs-time">' + MC.relativeTime(ob.created) + '</span>' +
          '</div>' +
          '<div class="m-obs-text">' + MC.esc(ob.text) + '</div>' +
          (tagChips ? '<div class="m-obs-tags">' + tagChips + '</div>' : '') +
        '</div>';
      });
    }

    return '<div class="m-screen m-screen-hidden" id="m-screen-student-detail">' +
      nav +
      '<div class="m-screen-content">' +
        hero + stats +
        focusHTML +
        '<div class="m-list-inset-header">Sections</div>' +
        sectionCards + assessCards + obsCards +
        '<div style="height:32px"></div>' +
      '</div></div>';
  }

  /* ── Handle search filtering ────────────────────────────────── */
  function filterList(query) {
    var q = (query || '').toLowerCase().trim();
    var list = document.getElementById('m-student-list');
    var stack = document.getElementById('m-student-card-stack');

    if (q) {
      // Searching: hide card stack, show list, filter it
      if (stack) stack.style.display = 'none';
      if (list) list.style.display = '';
      var cells = document.querySelectorAll('#m-student-list .m-cell');
      cells.forEach(function(cell) {
        var name = (cell.querySelector('.m-cell-title') || {}).textContent || '';
        cell.style.display = name.toLowerCase().indexOf(q) >= 0 ? '' : 'none';
      });
    } else {
      // Search cleared: restore the active view mode
      if (_viewMode === 'cards' && _stackInstance && stack) {
        stack.style.display = '';
        if (list) list.style.display = 'none';
      } else {
        // List mode or no card stack — show full list
        if (stack && _viewMode === 'list') stack.style.display = 'none';
        if (list) list.style.display = '';
        var cells = document.querySelectorAll('#m-student-list .m-cell');
        cells.forEach(function(cell) { cell.style.display = ''; });
      }
    }
  }

  /* ── Helpers ────────────────────────────────────────────────── */
  function _statCard(value, label, style) {
    return '<div class="m-stat-card">' +
      '<div class="m-stat-value"' + (style ? ' style="' + style + '"' : '') + '>' + value + '</div>' +
      '<div class="m-stat-label">' + label + '</div></div>';
  }

  return {
    renderList: renderList,
    renderDetail: renderDetail,
    filterList: filterList,
    initCardStack: initCardStack,
    destroyCardStack: destroyCardStack,
    setViewMode: setViewMode
  };
})();
