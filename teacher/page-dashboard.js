/* ── page-dashboard.js — Dashboard page module ───────────── */
window.PageDashboard = (function() {
  'use strict';

  /* ── Listener tracking for cleanup ──────────────────────── */
  var _listeners = [];
  function _addDocListener(type, handler, options) {
    document.addEventListener(type, handler, options);
    _listeners.push({ type: type, handler: handler, options: options });
  }

  /* ── State variables ────────────────────────────────────── */
  var activeCourse;
  var showFlaggedOnly = false;
  var sortMode = 'last-asc';
  var searchQuery = '';
  var _dashSearchTimer = null;

  /* ── Class Manager delegation (now in dash-class-manager.js) ── */
  var CM = DashClassManager;
  function openClassManager() { CM.classManagerOpen = true; CM.configure({ activeCourse: activeCourse, onRender: render, onCourseChange: switchCourse }); CM.openClassManager(); }
  function closeClassManager() { CM.closeClassManager(); }
  function renderClassManager() { CM.renderClassManager(); }

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
    CM.configure({ activeCourse: cid, onRender: render, onCourseChange: switchCourse });
    CM.resetState();
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
            var secLabel = sec.tags && sec.tags[0] ? sec.tags[0].id : sec.shortName || sec.name;
            html += '<div class="dash-section-mini" style="background:' + PROF_TINT[sr] + '">' +
              '<div style="position:absolute;top:0;left:4px;right:4px;height:3px;border-radius:2px;background:' + sec.color + '"></div>' +
              '<div class="dash-section-name">' + esc(secLabel) + '</div>' +
              '<div class="dash-section-val" style="color:' + PROF_COLORS[sr] + '">' + (secVal > 0 ? secVal.toFixed(1) : '\u2014') + '</div>' +
            '</div>';
          });
        } else {
          // No groups — flat section cards
          sections.forEach(function(sec) {
            var secVal = getSectionProficiency(cid, st.id, sec.id);
            var sr = Math.round(secVal);
            var secLabel = sec.tags && sec.tags[0] ? sec.tags[0].id : sec.shortName || sec.name;
            html += '<div class="dash-section-mini" style="background:' + PROF_TINT[sr] + '">' +
              '<div style="position:absolute;top:0;left:4px;right:4px;height:3px;border-radius:2px;background:' + sec.color + '"></div>' +
              '<div class="dash-section-name">' + esc(secLabel) + '</div>' +
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
    if (CM.classManagerOpen) { renderClassManager(); return; }
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

    var flagCount = Object.values(flags).filter(Boolean).length;
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

  /* ── Delegated click handler ────────────────────────────── */
  function _handleClick(e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.dataset.action;
    if (el.dataset.stopProp === 'true') e.stopPropagation();

    // Delegate cm/cw actions to class manager submodule
    if (CM.handleAction(action, el, e)) return;

    // Dashboard-only actions
    var handlers = {
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
    if (el.dataset.actionInput === 'dashSearch') { dashSearchInput(el); return; }
    CM.handleInput(el);
  }

  function _handleChange(e) {
    var el = e.target;
    // Dashboard-specific change handlers
    if (el.dataset.action === 'dashSwitchCourse') { switchCourse(el.value); return; }
    if (el.dataset.action === 'dashSort') { sortMode = el.value; render(); return; }
    // Delegate cm/cw change handlers
    CM.handleChange(el);
  }

  function _handleBlur(e) {
    CM.handleBlur(e.target);
  }

  /* ── init / destroy ─────────────────────────────────────── */
  function init(params) {
    // Reset state
    activeCourse = getActiveCourse();
    showFlaggedOnly = false;
    sortMode = 'last-asc';
    searchQuery = '';
    CM.configure({ activeCourse: activeCourse, onRender: render, onCourseChange: switchCourse });
    CM.resetState();

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
    CM.initDrag();

    render();

    // Ensure page starts at top
    requestAnimationFrame(function() { document.getElementById('main').scrollTop = 0; });
  }

  function destroy() {
    CM.destroy();
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
