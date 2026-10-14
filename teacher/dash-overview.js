/* dash-overview.js — Dashboard overview rendering helpers */
window.DashOverview = (function () {
  'use strict';

  function renderDashToolbar(opts) {
    var activeCourse = opts.activeCourse;
    var sortMode = opts.sortMode;
    var searchQuery = opts.searchQuery;
    var showFlaggedOnly = opts.showFlaggedOnly;
    var students = opts.students;
    var flagCount = opts.flagCount;
    var courseOptions = getPickerCourses(activeCourse)
      .map(function (c) {
        return (
          '<option value="' + c.id + '"' + (c.id === activeCourse ? ' selected' : '') + '>' + esc(c.name) + '</option>'
        );
      })
      .join('');
    return (
      '<div class="dash-toolbar">' +
      '<select class="dash-course-select" data-action="dashSwitchCourse" aria-label="Select course">' +
      courseOptions +
      '</select>' +
      '<button class="dash-add-btn" data-action="openClassManager">Class Management</button>' +
      '<div class="dash-search-wrap">' +
      '<span class="search-icon" aria-hidden="true">\uD83D\uDD0D</span>' +
      '<input class="dash-search-input" type="text" placeholder="Search students\u2026" value="' +
      esc(searchQuery) +
      '" data-action-input="dashSearch" aria-label="Search students">' +
      '</div>' +
      '<select class="dash-sort-select" data-action="dashSort" aria-label="Sort students">' +
      '<option value="last-asc"' +
      (sortMode === 'last-asc' ? ' selected' : '') +
      '>Last Name A\u2192Z</option>' +
      '<option value="last-desc"' +
      (sortMode === 'last-desc' ? ' selected' : '') +
      '>Last Name Z\u2192A</option>' +
      '<option value="first-asc"' +
      (sortMode === 'first-asc' ? ' selected' : '') +
      '>First Name A\u2192Z</option>' +
      '<option value="first-desc"' +
      (sortMode === 'first-desc' ? ' selected' : '') +
      '>First Name Z\u2192A</option>' +
      '<option value="overall-desc"' +
      (sortMode === 'overall-desc' ? ' selected' : '') +
      '>Overall High\u2192Low</option>' +
      '<option value="overall-asc"' +
      (sortMode === 'overall-asc' ? ' selected' : '') +
      '>Overall Low\u2192High</option>' +
      '<option value="flagged"' +
      (sortMode === 'flagged' ? ' selected' : '') +
      '>Flagged First</option>' +
      '</select>' +
      '<button class="dash-filter-chip' +
      (showFlaggedOnly ? ' active' : '') +
      '" data-action="toggleFlaggedFilter" aria-pressed="' +
      showFlaggedOnly +
      '" aria-label="Show flagged students only' +
      (flagCount > 0 ? ', ' + flagCount + ' flagged' : '') +
      '">\u2691 Flagged' +
      (flagCount > 0 ? ' (' + flagCount + ')' : '') +
      '</button>' +
      '<div class="dash-toolbar-spacer"></div>' +
      '<span class="dash-toolbar-label">' +
      students.length +
      ' student' +
      (students.length !== 1 ? 's' : '') +
      '</span>' +
      '</div>'
    );
  }

  function renderOverviewPanel(opts) {
    var cid = opts.cid;
    var sections = opts.sections;
    var allStudents = opts.allStudents;
    var assessments = opts.assessments;
    var classAvg = opts.classAvg;
    var classR = opts.classR;
    var tagCoveragePct = opts.tagCoveragePct;
    var sectionClassAvgs = opts.sectionClassAvgs;
    var tagsWithEvidence = opts.tagsWithEvidence;
    var allTags = opts.allTags;
    var tagCoverageMap = opts.tagCoverageMap;
    var assessedCCs = opts.assessedCCs;
    var ccCounts = opts.ccCounts;
    var ccAssessments = opts.ccAssessments;
    var recentObsCount = opts.recentObsCount;
    var flagCount = opts.flagCount;
    var actionItems = opts.actionItems;
    var html = '';

    html += '<div class="dash-section">';
    html += '<div class="dash-overview">';

    html += '<div class="dash-overview-section">';

    var distrib = { 1: 0, 2: 0, 3: 0, 4: 0 };
    var distribStudents = { 1: [], 2: [], 3: [], 4: [] };
    allStudents.forEach(function (s) {
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
        { level: 1, label: 'Emerging', color: 'var(--score-1)', tint: 'var(--score-1-bg)' },
      ];
      distribData.forEach(function (d) {
        var pct = (distrib[d.level] / totalWithProf) * 100;
        if (pct > 0) {
          var names = distribStudents[d.level]
            .sort()
            .map(function (n) {
              return '<div class="dist-tip-name">' + esc(n) + '</div>';
            })
            .join('');
          html +=
            '<div class="dist-seg" style="flex:' +
            distrib[d.level] +
            ';background:' +
            d.tint +
            ';display:flex;align-items:center;justify-content:center;min-width:' +
            (pct > 8 ? '0' : '28px') +
            ';transition:flex 0.3s var(--ease-out)">' +
            '<span style="font-family:var(--font-base);font-size:' +
            (pct > 15 ? '0.78rem' : '0.65rem') +
            ';font-weight:700;color:' +
            d.color +
            '">' +
            distrib[d.level] +
            '</span>' +
            '<div class="dist-tip">' +
            '<div class="dist-tip-title">' +
            d.label +
            '</div>' +
            names +
            '</div>' +
            '</div>';
        }
      });
      html += '</div>';
      html += '<div style="display:flex;gap:12px;margin-top:6px;justify-content:center">';
      distribData.forEach(function (d) {
        if (distrib[d.level] > 0) {
          html +=
            '<div style="display:flex;align-items:center;gap:4px">' +
            '<div style="width:8px;height:8px;border-radius:2px;background:' +
            d.color +
            '"></div>' +
            '<span style="font-family:var(--font-base);font-size:0.65rem;color:var(--text-2)">' +
            d.label +
            '</span>' +
            '</div>';
        }
      });
      html += '</div>';
    } else {
      html +=
        '<div style="height:28px;border-radius:8px;background:var(--overlay-hover);display:flex;align-items:center;justify-content:center">' +
        '<span style="font-family:var(--font-base);font-size:0.72rem;color:var(--text-3)">No data yet</span>' +
        '</div>';
    }

    html +=
      '<div style="margin-top:14px"><div class="dash-section-title">Curricular Competencies' +
      '<a href="#/gradebook?course=' +
      cid +
      '">View Gradebook \u2192</a>' +
      '</div></div>';

    html +=
      '<div class="dash-quick-stats">' +
      '<div class="dash-mini-stat">' +
      '<div class="dash-mini-stat-val" style="color:' +
      (classAvg > 0 ? PROF_COLORS[classR] : 'var(--text-3)') +
      '">' +
      (classAvg > 0 ? classAvg.toFixed(1) : '\u2014') +
      '</div>' +
      '<div class="dash-mini-stat-label">Class Avg</div>' +
      '</div>' +
      '<div class="dash-mini-stat">' +
      '<div class="dash-mini-stat-val" style="color:' +
      (tagCoveragePct >= 75 ? 'var(--score-3)' : tagCoveragePct >= 50 ? 'var(--score-2)' : 'var(--score-1)') +
      '">' +
      tagCoveragePct +
      '%</div>' +
      '<div class="dash-mini-stat-label">Standards Covered</div>' +
      '</div>' +
      '<div class="dash-mini-stat">' +
      '<div class="dash-mini-stat-val">' +
      assessments.length +
      '</div>' +
      '<div class="dash-mini-stat-label">Assessments</div>' +
      '</div>' +
      '</div>';

    sectionClassAvgs.forEach(function (item) {
      var sec = item.section;
      var avg = item.avg;
      var r = Math.round(avg);
      var pct = avg > 0 ? (avg / 4) * 100 : 0;
      var color = avg > 0 ? PROF_COLORS[r] : 'var(--text-3)';
      var rawColor =
        avg > 0
          ? r === 1
            ? 'var(--score-1)'
            : r === 2
              ? 'var(--score-2)'
              : r === 3
                ? 'var(--score-3)'
                : r === 4
                  ? 'var(--score-4)'
                  : 'var(--text-3)'
          : 'var(--divider-subtle)';
      html +=
        '<div class="dash-outcome-row">' +
        '<span class="dash-outcome-label" style="color:' +
        sec.color +
        '">' +
        esc(sec.shortName || sec.name) +
        '</span>' +
        '<div class="dash-outcome-bar-track">' +
        '<div class="dash-outcome-bar-fill" style="width:' +
        pct +
        '%;background:' +
        rawColor +
        '"></div>' +
        '</div>' +
        '<span class="dash-outcome-val" style="color:' +
        color +
        '">' +
        (avg > 0 ? avg.toFixed(1) : '\u2014') +
        '</span>' +
        '</div>';
    });

    html +=
      '<div style="margin-top:10px">' +
      "<div style=\"font-family:'SF Mono', ui-monospace, 'Menlo', monospace;font-size:0.52rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-3);margin-bottom:4px\">" +
      tagsWithEvidence +
      ' of ' +
      allTags.length +
      ' standards assessed</div>' +
      '<div class="dash-tag-grid">';
    sections.forEach(function (sec) {
      sec.tags.forEach(function (tag) {
        var hasEv = tagCoverageMap[tag.id];
        var bg = hasEv ? sec.color : 'var(--divider-subtle)';
        html +=
          '<div class="dash-tag-pip" title="' +
          esc(tag.text || tag.label) +
          (hasEv ? '' : ' \u2014 not yet assessed') +
          '" style="background:' +
          bg +
          '"></div>';
      });
    });
    html += '</div></div>';
    html += '</div>';

    html += '<div class="dash-overview-section">';
    html +=
      '<div style="margin-top:0">' +
      '<div class="dash-section-title">Observations' +
      '<a href="#/observations">Record \u2192</a>' +
      '</div>' +
      '<div class="dash-quick-stats">' +
      '<div class="dash-mini-stat">' +
      '<div class="dash-mini-stat-val" style="color:var(--active)">' +
      recentObsCount +
      '</div>' +
      '<div class="dash-mini-stat-label">This Week</div>' +
      '</div>' +
      '<div class="dash-mini-stat">' +
      '<div class="dash-mini-stat-val" style="color:' +
      (flagCount > 0 ? 'var(--priority)' : 'var(--text-3)') +
      '">' +
      flagCount +
      '</div>' +
      '<div class="dash-mini-stat-label">Flagged</div>' +
      '</div>' +
      '<div class="dash-mini-stat">' +
      '<div class="dash-mini-stat-val">' +
      allStudents.length +
      '</div>' +
      '<div class="dash-mini-stat-label">Students</div>' +
      '</div>' +
      '</div>' +
      '</div>';

    var upcomingBdays = getUpcomingBirthdays(cid);
    if (upcomingBdays.length > 0) {
      html += '<div style="margin-top:14px">' + '<div class="dash-section-title">Upcoming Birthdays</div>';
      upcomingBdays.forEach(function (b) {
        var dob = new Date(b.student.dateOfBirth);
        var monthDay = dob.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
        var countdown =
          b.daysUntil === 0
            ? '<span style="color:var(--score-3);font-weight:600">Today!</span>'
            : b.daysUntil === 1
              ? '<span style="color:var(--score-2);font-weight:600">Tomorrow</span>'
              : '<span style="color:var(--text-3)">in ' + b.daysUntil + ' days</span>';
        html +=
          '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:0.82rem">' +
          '<div class="bday-avatar">' +
          initials(b.student) +
          '</div>' +
          '<span style="font-weight:500;color:var(--text)">' +
          esc(displayName(b.student)) +
          '</span>' +
          '<span style="font-size:0.75rem;color:var(--text-3)">' +
          monthDay +
          '</span>' +
          '<span style="margin-left:auto;font-size:0.75rem">' +
          countdown +
          '</span>' +
          '</div>';
      });
      html += '</div>';
    }

    html += '</div>';

    html += '<div class="dash-overview-section">' + '<div class="dash-section-title">Core Competencies</div>';

    html += '<div class="dash-cc-grid">';
    CORE_COMPETENCIES.forEach(function (cc) {
      var assessed = assessedCCs.has(cc.id);
      var count = ccCounts[cc.id] || 0;
      var aNames = (ccAssessments[cc.id] || [])
        .map(function (n) {
          return '<div class="dist-tip-name">' + esc(n) + '</div>';
        })
        .join('');
      html +=
        '<div class="dash-cc-pill" style="' +
        (!assessed ? 'opacity:0.4' : '') +
        '">' +
        '<div class="dash-cc-dot" style="background:' +
        (assessed ? cc.color : 'var(--border)') +
        '"></div>' +
        esc(cc.label) +
        (count > 0 ? '<span class="dash-cc-count">' + count + '</span>' : '') +
        (count > 0
          ? '<div class="dist-tip"><div class="dist-tip-title">' + esc(cc.label) + '</div>' + aNames + '</div>'
          : '') +
        '</div>';
    });
    html += '</div>';

    html += '<div style="margin-top:14px"><div class="dash-section-title">Next Steps</div>';

    if (actionItems.length === 0) {
      html +=
        '<div class="dash-action-item"><span class="dash-action-dot" style="background:var(--score-3)"></span><span class="dash-action-text" style="color:var(--score-3)">Looking good! All standards covered, all competencies tagged.</span></div>';
    } else {
      html += '<div class="dash-action-list">';
      actionItems.forEach(function (item) {
        html +=
          '<div class="dash-action-item">' +
          '<span class="dash-action-dot"></span>' +
          '<span class="dash-action-text">' +
          esc(item.text) +
          '</span>' +
          (item.link
            ? '<a class="dash-action-link" href="' + item.link + '">' + esc(item.linkText) + ' &rarr;</a>'
            : '') +
          '</div>';
      });
      html += '</div>';
    }

    html += '</div>';
    html += '</div>';

    return html;
  }

  function renderBirthdayWidget(cid) {
    var upcomingBdays = getUpcomingBirthdays(cid);
    if (upcomingBdays.length === 0) return '';
    var html = '<div class="dash-birthday-box">' + '<div class="dash-section-title">Upcoming Birthdays</div>';
    upcomingBdays.forEach(function (b) {
      var dob = new Date(b.student.dateOfBirth);
      var monthDay = dob.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      var countdown =
        b.daysUntil === 0
          ? '<span class="bday-today">Today!</span>'
          : b.daysUntil === 1
            ? '<span class="bday-soon">Tomorrow</span>'
            : '<span class="bday-days">in ' + b.daysUntil + ' days</span>';
      html +=
        '<div class="bday-row">' +
        '<div class="bday-avatar">' +
        initials(b.student) +
        '</div>' +
        '<div class="bday-info">' +
        '<div class="bday-name">' +
        esc(displayName(b.student)) +
        '</div>' +
        '<div class="bday-date">' +
        monthDay +
        '</div>' +
        '</div>' +
        '<div class="bday-countdown">' +
        countdown +
        '</div>' +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  return {
    renderDashToolbar: renderDashToolbar,
    renderOverviewPanel: renderOverviewPanel,
    renderBirthdayWidget: renderBirthdayWidget,
  };
})();
