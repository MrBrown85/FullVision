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
      '<div class="page-toolbar dash-toolbar">' +
      '<select class="class-picker dash-course-select" data-action="dashSwitchCourse" aria-label="Select course">' +
      courseOptions +
      '</select>' +
      '<button class="tb-action-btn tb-action-secondary" data-action="openClassManager">Class Management</button>' +
      (typeof renderTermPicker === 'function' ? renderTermPicker(activeCourse) : '') +
      '<div class="dash-search-wrap">' +
      '<span class="search-icon" aria-hidden="true">' +
      LINE_ICONS.search +
      '</span>' +
      '<input class="dash-search-input" type="text" placeholder="Search students\u2026" value="' +
      esc(searchQuery) +
      '" data-action-input="dashSearch" aria-label="Search students">' +
      '</div>' +
      '<select class="term-select dash-sort-select" data-action="dashSort" aria-label="Sort students">' +
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
      ' Student' +
      (students.length !== 1 ? 's' : '') +
      '</span>' +
      '</div>'
    );
  }

  /* The top bar: Class Average with its proficiency (or letter) mix, Missing
     and Late, and Upcoming Birthdays. */
  function glanceHtml(opts) {
    var cid = opts.cid;
    var allStudents = opts.allStudents;
    var studentIds = allStudents.map(function (s) {
      return s.id;
    });
    // The class average as this class shows grades (level, letter, or both).
    var classGrade = classGradeSummary(cid, studentIds);
    var word = levelWord(cid, opts.classAvg);
    var html = '<section class="dash-glance" aria-label="Class at a Glance">';

    html +=
      '<div class="dash-glance-cell dash-glance-avg">' +
      '<span class="dash-glance-label">Class Average</span>' +
      '<span class="dash-glance-value">' +
      esc(classGrade.text || '\u2014') +
      (word
        ? '<span class="dash-glance-word" style="color:var(--score-' +
          classGrade.level +
          '-text)">' +
          esc(word) +
          '</span>'
        : '') +
      '</span>';
    if (opts.classChange) {
      html +=
        '<span class="dash-glance-change' +
        (opts.classChange.dir > 0 ? ' is-up' : opts.classChange.dir < 0 ? ' is-down' : '') +
        '">' +
        esc(opts.classChange.text + ' Since ' + opts.classChange.since) +
        '</span>';
    }

    // By letter grade in a Letter class, by proficiency otherwise. Each part
    // lists its students on hover.
    var nameById = {};
    allStudents.forEach(function (s) {
      nameById[s.id] = displayName(s);
    });
    var distribData = classGradeDistribution(cid, studentIds).filter(function (d) {
      return d.ids.length > 0;
    });
    if (distribData.length) {
      html += '<div class="dash-glance-dist">';
      distribData.forEach(function (d) {
        var names = d.ids
          .map(function (id) {
            return nameById[id];
          })
          .sort()
          .map(function (n) {
            return '<div class="dist-tip-name">' + esc(n) + '</div>';
          })
          .join('');
        html +=
          '<div class="dist-seg" style="flex:' +
          d.ids.length +
          ';background:var(--score-' +
          d.level +
          ')">' +
          '<div class="dist-tip"><div class="dist-tip-title">' +
          esc(d.label) +
          '</div>' +
          names +
          '</div></div>';
      });
      html += '</div><div class="dash-glance-key">';
      distribData.forEach(function (d) {
        html += '<span><b>' + d.ids.length + '</b> ' + esc(d.label) + '</span>';
      });
      html += '</div>';
    } else {
      html += '<span class="dash-glance-sub">No scores yet.</span>';
    }
    html += '</div>';

    html += DashInsights.missingGlanceHtml(opts.missing || []);

    var bdays = getUpcomingBirthdays(cid);
    html += '<div class="dash-glance-cell dash-glance-bdays"><span class="dash-glance-label">Upcoming Birthdays</span>';
    if (!bdays.length) {
      html += '<span class="dash-glance-sub">No birthdays on file.</span>';
    } else {
      html += '<div class="dash-bdays">';
      bdays.forEach(function (b) {
        var day = b.nextBday.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
        var countdown = b.daysUntil === 0 ? 'Today' : b.daysUntil === 1 ? 'Tomorrow' : 'in ' + b.daysUntil + ' days';
        html +=
          '<div class="dash-bday">' +
          '<span class="dash-bday-name">' +
          esc(displayNameWithLast(b.student)) +
          '</span>' +
          '<span class="dash-bday-when' +
          (b.daysUntil <= 1 ? ' is-soon' : '') +
          '">' +
          '<span>' +
          esc(day) +
          '</span> · <span>' +
          esc(countdown) +
          '</span>' +
          '</span>' +
          '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
    return html + '</section>';
  }

  /* Curricular Competencies: the proficiency mix with "N Below" in a
     Proficiency or Both class, each competency's average in a Letter class;
     a line with the assessments and standards assessed under it. */
  function competenciesCardHtml(opts) {
    var cid = opts.cid;
    var html =
      '<section class="dash-overview-section dash-comp-card" aria-labelledby="dash-comp-title">' +
      '<div class="dash-section-title"><span id="dash-comp-title">Curricular Competencies</span>' +
      '<a role="link" tabindex="0" data-href="#/gradebook?course=' +
      cid +
      '">View Gradebook \u2192</a></div>';
    if (DashInsights.showsProficiency(cid)) {
      html +=
        DashInsights.mixLegendHtml(cid) +
        DashInsights.mixListHtml(cid, opts.allStudents, opts.mixPop, opts.belowCounts, opts.naComp);
    } else {
      html += '<div class="dash-outcome-list" aria-label="Curricular competencies">';
      opts.sectionClassAvgs.forEach(function (item) {
        var sec = item.section;
        var avg = item.avg;
        var r = Math.round(avg);
        html +=
          '<div class="dash-outcome-row">' +
          '<span class="dash-outcome-label" title="' +
          esc(sec.name || sec.shortName || '') +
          '">' +
          esc(sec.shortName || sec.name) +
          '</span>' +
          '<div class="dash-outcome-bar-track">' +
          '<div class="dash-outcome-bar-fill" style="width:' +
          (avg > 0 ? (avg / 4) * 100 : 0) +
          '%;background:' +
          (avg > 0 ? 'var(--score-' + r + ')' : 'var(--divider-subtle)') +
          '"></div>' +
          '</div>' +
          '<span class="dash-outcome-val">' +
          esc(formatLevel(cid, avg)) +
          '</span>' +
          '</div>';
      });
      html += '</div>';
    }
    var n = opts.assessments.length;
    html +=
      '<div class="dash-comp-foot">' +
      n +
      ' assessment' +
      (n === 1 ? '' : 's') +
      ' · ' +
      opts.tagsWithEvidence +
      ' of ' +
      opts.allTags.length +
      ' standards assessed</div>';
    return html + '</section>';
  }

  /* Core Competencies: each with how many assessments are tagged with it,
     and their titles on hover. */
  function coreCardHtml(opts) {
    var html =
      '<section class="dash-overview-section dash-core-card" aria-labelledby="dash-core-title">' +
      '<div class="dash-section-title"><span id="dash-core-title">Core Competencies</span>' +
      '<span class="dash-core-sub">Assessments Tagged</span></div><div class="dash-core-list">';
    CORE_COMPETENCIES.forEach(function (cc) {
      var count = opts.ccCounts[cc.id] || 0;
      var names = (opts.ccAssessments[cc.id] || [])
        .map(function (n) {
          return '<div class="dist-tip-name">' + esc(n) + '</div>';
        })
        .join('');
      html +=
        '<div class="dash-core-row' +
        (count ? '' : ' is-unassessed') +
        '">' +
        '<span class="dash-core-dot" style="' +
        (count ? 'background:' + cc.color : '') +
        '"></span>' +
        '<span class="dash-core-name">' +
        esc(cc.label) +
        '</span>' +
        '<span class="dash-core-count">' +
        (count || '\u2014') +
        '</span>' +
        (count
          ? '<div class="dist-tip"><div class="dist-tip-title">' + esc(cc.label) + '</div>' + names + '</div>'
          : '') +
        '</div>';
    });
    return html + '</div></section>';
  }

  /* The dashboard under the toolbar: the top bar; Needs Attention beside
     Curricular and Core Competencies; then Observations across the page.
     page-dashboard.js re-renders only the Observations card's inside for its
     tab, flag and Hide Names clicks. */
  function renderOverviewPanel(opts) {
    var cid = opts.cid;
    var allStudents = opts.allStudents;
    var missing = DashInsights.missingItems(cid, allStudents, getTodayStr());
    var model = DashInsights.attentionModel(cid, allStudents, { rule: opts.helpRule });
    var html = '<div class="dash-section dash-overview">';
    html += glanceHtml(Object.assign({}, opts, { missing: missing }));
    html += '<div class="dash-overview-row dash-overview-main">';
    html += DashInsights.attentionCardHtml(cid, model, {
      filter: opts.naFilter,
      comp: opts.naComp,
      ruleOpen: opts.helpRuleOpen,
      classItems: opts.actionItems,
    });
    html +=
      '<div class="dash-overview-side">' +
      competenciesCardHtml(Object.assign({}, opts, { belowCounts: DashInsights.belowCounts(model) })) +
      coreCardHtml(opts) +
      '</div>';
    html += '</div>';
    html +=
      '<section class="dash-overview-section dash-ob2" id="dash-obs-card" aria-labelledby="dash-ob2-title">' +
      DashObservations.renderCard(cid, allStudents, opts.obs || {}) +
      '</section>';
    html += '</div>';
    return html;
  }

  /* ── Observation weeks and overdue ──────────────────────────
     The Observations card (dash-observations.js) and the student cards use
     these. They are pure and take today's date as 'YYYY-MM-DD' so tests can
     pin it. */
  var OBS_OVERDUE_DAYS = 21;
  var OBS_DEFAULT_WEEKS = 8;
  var DAY_MS = 86400000;

  function _dayNum(dateStr) {
    return Math.floor(Date.parse(String(dateStr).slice(0, 10) + 'T00:00:00Z') / DAY_MS);
  }

  function _isDateStr(d) {
    return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) && !isNaN(Date.parse(d.slice(0, 10)));
  }

  function _dayStr(n) {
    return new Date(n * DAY_MS).toISOString().slice(0, 10);
  }

  /** Monday of the ISO week that contains a 'YYYY-MM-DD' date. */
  function obsWeekStart(dateStr) {
    var n = _dayNum(dateStr);
    var mondayOffset = (new Date(n * DAY_MS).getUTCDay() + 6) % 7;
    return _dayStr(n - mondayOffset);
  }

  /** Mondays of the grid's columns: the term's weeks up to today, or the last 8 weeks with no term. */
  function obsCoverageWeeks(todayStr, term) {
    var first, last;
    if (term && term.startsOn && term.endsOn) {
      var end = todayStr < term.endsOn ? todayStr : term.endsOn;
      if (end < term.startsOn) end = term.startsOn;
      first = _dayNum(obsWeekStart(term.startsOn));
      last = _dayNum(obsWeekStart(end));
    } else {
      last = _dayNum(obsWeekStart(todayStr));
      first = last - (OBS_DEFAULT_WEEKS - 1) * 7;
    }
    var weeks = [];
    for (var n = first; n <= last; n += 7) weeks.push(_dayStr(n));
    return weeks;
  }

  /** The latest observation date in a list, or '' when there is none. */
  function obsLastDate(obs) {
    return (obs || []).reduce(function (latest, o) {
      var d = o && _isDateStr(o.date) ? o.date.slice(0, 10) : '';
      return d > latest ? d : latest;
    }, '');
  }

  /** True when a student has no observation in the last 3 weeks (or none at all). */
  function obsIsOverdue(obs, todayStr) {
    var last = obsLastDate(obs);
    if (!last) return true;
    return _dayNum(todayStr) - _dayNum(last) >= OBS_OVERDUE_DAYS;
  }

  function renderBirthdayWidget(cid) {
    var upcomingBdays = getUpcomingBirthdays(cid);
    if (upcomingBdays.length === 0) return '';
    var html = '<div class="dash-birthday-box">' + '<div class="dash-section-title">Upcoming Birthdays</div>';
    upcomingBdays.forEach(function (b) {
      var dob = parseLocalDate(b.student.dateOfBirth);
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
    glanceHtml: glanceHtml,
    renderBirthdayWidget: renderBirthdayWidget,
    obsWeekStart: obsWeekStart,
    obsCoverageWeeks: obsCoverageWeeks,
    obsLastDate: obsLastDate,
    obsIsOverdue: obsIsOverdue,
  };
})();
