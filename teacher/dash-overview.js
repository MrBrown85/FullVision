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
      (typeof renderTermPicker === 'function' ? renderTermPicker(activeCourse) : '') +
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
    // The class average as this class shows grades (level, letter, or both).
    var classGrade = classGradeSummary(
      cid,
      (allStudents || []).map(function (s) {
        return s.id;
      }),
    );
    var tagCoveragePct = opts.tagCoveragePct;
    var sectionClassAvgs = opts.sectionClassAvgs;
    var tagsWithEvidence = opts.tagsWithEvidence;
    var allTags = opts.allTags;
    var tagCoverageMap = opts.tagCoverageMap;
    var assessedCCs = opts.assessedCCs;
    var ccCounts = opts.ccCounts;
    var ccAssessments = opts.ccAssessments;
    var actionItems = opts.actionItems;
    var html = '';

    html += '<div class="dash-section">';
    html += '<div class="dash-overview">';

    html += '<div class="dash-overview-section">';

    // By letter grade in a Letter class, by proficiency level otherwise.
    var nameById = {};
    allStudents.forEach(function (s) {
      nameById[s.id] = displayName(s);
    });
    var studentIds = allStudents.map(function (s) {
      return s.id;
    });
    var distribData = classGradeDistribution(cid, studentIds).filter(function (d) {
      return d.ids.length > 0;
    });
    var totalWithProf = distribData.reduce(function (sum, d) {
      return sum + d.ids.length;
    }, 0);

    html += '<div class="dash-section-title">Class Distribution</div>';
    if (totalWithProf > 0) {
      html += '<div style="display:flex;height:28px;gap:2px">';
      distribData.forEach(function (d) {
        var count = d.ids.length;
        var pct = (count / totalWithProf) * 100;
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
          count +
          ';background:var(--score-' +
          d.level +
          '-bg);display:flex;align-items:center;justify-content:center;min-width:' +
          (pct > 8 ? '0' : '28px') +
          ';transition:flex 0.3s var(--ease-out)">' +
          '<span style="font-family:var(--font-base);font-size:' +
          (pct > 15 ? '0.78rem' : '0.65rem') +
          ';font-weight:700;color:var(--score-' +
          d.level +
          ')">' +
          count +
          '</span>' +
          '<div class="dist-tip">' +
          '<div class="dist-tip-title">' +
          esc(d.label) +
          '</div>' +
          names +
          '</div>' +
          '</div>';
      });
      html += '</div>';
      html += '<div style="display:flex;gap:12px;margin-top:6px;justify-content:center">';
      distribData.forEach(function (d) {
        html +=
          '<div style="display:flex;align-items:center;gap:4px">' +
          '<div style="width:8px;height:8px;border-radius:2px;background:var(--score-' +
          d.level +
          ')"></div>' +
          '<span style="font-family:var(--font-base);font-size:0.65rem;color:var(--text-2)">' +
          esc(d.label) +
          '</span>' +
          '</div>';
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
      (classGrade.level > 0 ? PROF_COLORS[classGrade.level] : 'var(--text-3)') +
      '">' +
      (classGrade.text || '\u2014') +
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

    // The list scrolls past six competencies so the card keeps its size.
    html += '<div class="dash-outcome-list" tabindex="0" aria-label="Curricular competencies">';
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
        formatLevel(cid, avg) +
        '</span>' +
        '</div>';
    });
    html += '</div>';

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
    var obsCoverage = obsCoverageData(cid, allStudents);
    html += renderObsOverdue(cid, allStudents, obsCoverage);

    var upcomingBdays = getUpcomingBirthdays(cid);
    if (upcomingBdays.length > 0) {
      html += '<div style="margin-top:14px">' + '<div class="dash-section-title">Upcoming Birthdays</div>';
      upcomingBdays.forEach(function (b) {
        var dob = parseLocalDate(b.student.dateOfBirth);
        var monthDay = dob.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
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

    html += '<div class="dash-next-steps"><div class="dash-section-title">Next Steps</div>';

    if (actionItems.length === 0) {
      html +=
        '<div class="dash-action-item"><span class="dash-action-dot" style="background:var(--score-3)"></span><span class="dash-action-text" style="color:var(--score-3)">Looking good! All standards covered, all competencies tagged.</span></div>';
    } else {
      html += '<div class="dash-action-list">';
      actionItems.forEach(function (item) {
        html +=
          '<div class="dash-action-item">' +
          '<span class="dash-action-dot"></span>' +
          '<span class="dash-action-text" title="' +
          esc(item.text) +
          '">' +
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

    // The coverage grid takes a full-width row under the three cards.
    var grid = renderObsCoverageGrid(cid, obsCoverage);
    if (grid) html += '<div class="dash-overview-section dash-obs-coverage">' + grid + '</div>';

    return html;
  }

  /* ── Observation coverage ───────────────────────────────────
     Who has gone 3+ weeks without an observation, and a students-by-week
     grid of observation counts tinted by type. The calculations are pure
     and take today's date as 'YYYY-MM-DD' so tests can pin it. */
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

  /** The term the grid covers: the picker's term, else the one today falls in, else null. */
  function obsCoverageTerm(terms, activeTerm, todayStr) {
    if (activeTerm && activeTerm.startsOn && activeTerm.endsOn) return activeTerm;
    var current = (terms || []).find(function (t) {
      var s = t.startsOn || t.starts_on;
      var e = t.endsOn || t.ends_on;
      return s && e && s <= todayStr && todayStr <= e;
    });
    if (!current) return null;
    return {
      ordinal: current.ordinal,
      label: current.label,
      startsOn: current.startsOn || current.starts_on,
      endsOn: current.endsOn || current.ends_on,
    };
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

  /** A week's tint: the type that has the most observations; 'mixed' on a tie, 'neutral' when none is typed. */
  function obsCellTint(obs) {
    if (!obs || obs.length === 0) return 'empty';
    var counts = { strength: 0, growth: 0, concern: 0 };
    obs.forEach(function (o) {
      if (o && counts.hasOwnProperty(o.sentiment)) counts[o.sentiment]++;
    });
    var max = Math.max(counts.strength, counts.growth, counts.concern);
    if (max === 0) return 'neutral';
    var top = Object.keys(counts).filter(function (k) {
      return counts[k] === max;
    });
    return top.length === 1 ? top[0] : 'mixed';
  }

  /** One row per student, in the order given: overdue flag and one cell per week. */
  function obsCoverageRows(students, obsBySid, weeks, todayStr) {
    var index = {};
    weeks.forEach(function (w, i) {
      index[w] = i;
    });
    return (students || []).map(function (s) {
      var obs = obsBySid[s.id] || [];
      var byWeek = weeks.map(function () {
        return [];
      });
      obs.forEach(function (o) {
        if (!o || !_isDateStr(o.date)) return;
        var i = index[obsWeekStart(o.date)];
        if (i !== undefined) byWeek[i].push(o);
      });
      return {
        student: s,
        overdue: obsIsOverdue(obs, todayStr),
        lastDate: obsLastDate(obs),
        cells: weeks.map(function (w, i) {
          return { week: w, obs: byWeek[i], tint: obsCellTint(byWeek[i]) };
        }),
      };
    });
  }

  function _weekLabel(week) {
    return new Date(_dayNum(week) * DAY_MS).toLocaleDateString('en-CA', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }

  function _obsCellTitle(name, week, obs) {
    var head = name + ', week of ' + _weekLabel(week) + ': ';
    if (obs.length === 0) return head + 'no observations';
    var lines = obs
      .slice()
      .sort(function (a, b) {
        return (a.date || '').localeCompare(b.date || '');
      })
      .slice(0, 6)
      .map(function (o) {
        var t = String(o.text || '').replace(/\s+/g, ' ');
        return '\u2013 ' + (t.length > 100 ? t.slice(0, 99) + '\u2026' : t);
      });
    if (obs.length > 6) lines.push('and ' + (obs.length - 6) + ' more');
    return head + obs.length + (obs.length === 1 ? ' observation' : ' observations') + '\n' + lines.join('\n');
  }

  /* The overdue list and the grid for a class, for today and the term in view. */
  function obsCoverageData(cid, students) {
    var today = getTodayStr();
    var terms = typeof getReportingTerms === 'function' ? getReportingTerms(cid) : [];
    var active = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;
    var term = obsCoverageTerm(terms, active, today);
    var weeks = obsCoverageWeeks(today, term);
    var obsBySid = {};
    students.forEach(function (s) {
      obsBySid[s.id] = getStudentQuickObs(cid, s.id);
    });
    var rows = obsCoverageRows(students, obsBySid, weeks, today);
    return {
      term: term,
      weeks: weeks,
      rows: rows,
      overdue: rows.filter(function (r) {
        return r.overdue;
      }),
    };
  }

  /* Headline and chips: who has no observation in 3+ weeks. */
  function renderObsOverdue(cid, students, data) {
    var overdue = data.overdue;
    var html =
      '<div class="dash-section-title">Observations' +
      '<a href="#/observations?course=' +
      encodeURIComponent(cid) +
      '">Record \u2192</a>' +
      '</div>';

    if (students.length === 0) {
      return html + '<div class="dash-obs-headline">No students yet</div>';
    }

    if (overdue.length > 0) {
      html +=
        '<div class="dash-obs-headline is-overdue">' +
        overdue.length +
        (overdue.length === 1 ? ' student has' : ' students have') +
        ' no observation in 3+ weeks</div>' +
        '<div class="dash-obs-overdue" aria-label="Students with no observation in 3 or more weeks">';
      overdue.forEach(function (r) {
        var s = r.student;
        html +=
          '<a class="dash-obs-chip" href="#/student?id=' +
          encodeURIComponent(s.id) +
          '&course=' +
          encodeURIComponent(cid) +
          '" title="' +
          esc(
            r.lastDate
              ? 'Last observed ' +
                  parseLocalDate(r.lastDate).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
              : 'No observations yet',
          ) +
          '">' +
          esc(displayName(s)) +
          '</a>';
      });
      html += '</div>';
    } else {
      html += '<div class="dash-obs-headline">Everyone observed in the last 3 weeks</div>';
    }

    return html;
  }

  /* Students-by-week grid of observation counts, tinted by type. */
  function renderObsCoverageGrid(cid, data) {
    var term = data.term;
    var weeks = data.weeks;
    var rows = data.rows;
    if (rows.length === 0) return '';
    var title = term
      ? 'Observations by week, ' + (term.label || 'this term')
      : 'Observations by week, last ' + OBS_DEFAULT_WEEKS + ' weeks';
    var html =
      '<div class="dash-section-title">' +
      esc(title) +
      '</div>' +
      '<div class="dash-obs-grid-wrap" tabindex="0" role="region" aria-label="Observations by student and week">' +
      '<table class="dash-obs-grid">' +
      '<thead><tr><th scope="col" class="dash-obs-grid-name">Student</th>';
    var prevMonth = '';
    weeks.forEach(function (w) {
      var d = new Date(_dayNum(w) * DAY_MS);
      var month = d.toLocaleDateString('en-CA', { month: 'short', timeZone: 'UTC' });
      html +=
        '<th scope="col" title="Week of ' +
        esc(_weekLabel(w)) +
        '"><span class="dash-obs-grid-month">' +
        (month !== prevMonth ? esc(month) : '') +
        '</span>' +
        d.getUTCDate() +
        '</th>';
      prevMonth = month;
    });
    html += '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var s = r.student;
      var name = displayName(s);
      var obsHref = '#/observations?course=' + encodeURIComponent(cid) + '&student=' + encodeURIComponent(s.id);
      html +=
        '<tr><th scope="row" class="dash-obs-grid-name' +
        (r.overdue ? ' is-overdue' : '') +
        '"><a href="#/student?id=' +
        encodeURIComponent(s.id) +
        '&course=' +
        encodeURIComponent(cid) +
        '"' +
        (r.overdue ? ' title="No observation in 3+ weeks"' : '') +
        '>' +
        esc(name) +
        '</a></th>';
      r.cells.forEach(function (c) {
        html +=
          '<td><a class="dash-obs-cell dash-obs-tint-' +
          c.tint +
          '" href="' +
          obsHref +
          '" title="' +
          esc(_obsCellTitle(name, c.week, c.obs)) +
          '">' +
          (c.obs.length || '') +
          '</a></td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    html +=
      '<div class="dash-obs-legend">' +
      '<span><i class="dash-obs-tint-strength"></i>Strengths</span>' +
      '<span><i class="dash-obs-tint-growth"></i>Growth</span>' +
      '<span><i class="dash-obs-tint-concern"></i>Concerns</span>' +
      '<span><i class="dash-obs-tint-empty"></i>None</span>' +
      '</div>';
    return html;
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
    renderBirthdayWidget: renderBirthdayWidget,
    renderObsOverdue: renderObsOverdue,
    renderObsCoverageGrid: renderObsCoverageGrid,
    obsCoverageData: obsCoverageData,
    obsWeekStart: obsWeekStart,
    obsCoverageTerm: obsCoverageTerm,
    obsCoverageWeeks: obsCoverageWeeks,
    obsLastDate: obsLastDate,
    obsIsOverdue: obsIsOverdue,
    obsCellTint: obsCellTint,
    obsCoverageRows: obsCoverageRows,
  };
})();
