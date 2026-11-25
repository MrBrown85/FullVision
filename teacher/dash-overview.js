/* dash-overview.js — Dashboard overview rendering helpers */
window.DashOverview = (function () {
  'use strict';

  function renderDashToolbar(opts) {
    var activeCourse = opts.activeCourse;
    var students = opts.students;
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
      '<button class="tb-action-btn tb-action-secondary" data-action="openClassManager">Class Settings</button>' +
      '<div class="dash-toolbar-spacer"></div>' +
      '<span class="dash-toolbar-label">' +
      students.length +
      ' Student' +
      (students.length !== 1 ? 's' : '') +
      '</span>' +
      '</div>'
    );
  }

  /* Search, sort and Flagged, in the Students heading beside Cards | Grid. */
  function studentControlsHtml(opts) {
    var sortMode = opts.sortMode;
    var searchQuery = opts.searchQuery;
    var showFlaggedOnly = opts.showFlaggedOnly;
    var flagCount = opts.flagCount;
    return (
      '<div class="dash-search-wrap">' +
      '<span class="search-icon" aria-hidden="true">' +
      LINE_ICONS.search +
      '</span>' +
      '<input class="dash-search-input" type="text" placeholder="Search students\u2026" value="' +
      esc(searchQuery) +
      '" data-action-input="dashSearch" aria-label="Search students">' +
      '</div>' +
      '<select class="term-select dash-sort-select" data-action="dashSort" aria-label="Sort students">' +
      (opts.extraSort
        ? '<option value="' + esc(opts.extraSort.value) + '" selected>' + esc(opts.extraSort.label) + '</option>'
        : '') +
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
      '">' +
      LINE_ICONS.flag +
      'Flagged' +
      (flagCount > 0 ? ' (' + flagCount + ')' : '') +
      '</button>'
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
    // The To Grade cell (S6-F5) takes a column of its own; Upcoming
    // Birthdays then shows only the next birthday (the board's cost note).
    var toGrade = toGradeGlanceHtml(cid, studentIds);
    var html = '<section class="dash-glance' + (toGrade ? ' has-to-grade' : '') + '" aria-label="Class at a Glance">';

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
        (opts.classChange.dir > 0 ? ' is-up' : opts.classChange.dir < 0 ? ' is-down' : ' is-none') +
        '"' +
        (opts.classChange.dir ? '' : ' aria-hidden="true"') +
        '>' +
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

    html += toGrade;
    html += DashInsights.missingGlanceHtml(opts.missing || [], cid);

    var bdays = getUpcomingBirthdays(cid);
    if (toGrade) bdays = bdays.slice(0, 1);
    html += '<div class="dash-glance-cell dash-glance-bdays"><span class="dash-glance-label">Upcoming Birthdays</span>';
    if (!bdays.length) {
      html += '<span class="dash-glance-sub">No birthdays on file.</span>';
    } else {
      html += '<div class="dash-bdays">';
      // Days to go in the bar's large figures (Today and Tomorrow in green),
      // then the full name and the date.
      bdays.forEach(function (b) {
        var date = b.nextBday.toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric' });
        var count =
          b.daysUntil === 0
            ? '<b class="is-soon">Today</b>'
            : b.daysUntil === 1
              ? '<b class="is-soon">Tomorrow</b>'
              : '<b>' + b.daysUntil + '</b><span>days</span>';
        html +=
          '<div class="dash-bday">' +
          '<span class="dash-bday-count">' +
          count +
          '</span>' +
          '<span class="dash-bday-name">' +
          esc(displayNameWithLast(b.student)) +
          '</span>' +
          '<span class="dash-bday-date">' +
          esc(date) +
          '</span>' +
          '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
    return html + '</section>';
  }

  /* The To Grade cell (S6-F5, the board "Dashboard, To Grade Cell"): in a
     class whose student page and Send Work are on, a number and one line
     under it, like Missing and Late beside it. A click goes to the Inbox
     (the Inbox shows wherever this cell does); the link opens Assignments
     with the To Grade filter on in a new tab, or where the Inbox is not on
     the page. Its numbers are
     GraderWork.classWorkCounts', the same the gradebook's bar and the
     grader's Show bar give. '' (no cell, the row as it was) with Send Work
     off. The states on the board:
     - "9 / 4 Not Returned"; with work sitting a week or more,
       "· Oldest 11 Days" in amber;
     - "0 / All Caught Up · 27 Returned This Week" when nothing waits;
     - "0 / 3 Not Returned" when graded but not returned;
     - "4 / 4 Groups · 1 Not Returned" when what waits is group work.
     Counts only, never grades, so every grading style looks the same. */
  // html-safe: numbers and fixed words; the link is our path and id
  function toGradeGlanceHtml(cid, studentIds) {
    if (!window.GraderWork || !GraderWork.workOnInClass(cid)) return '';
    var c = classWorkCounts(cid, studentIds);
    // A question waiting (S10-F4) rides in the same cell: "· 1 Question".
    var asked = questionsIn(cid).length;
    var parts = [];
    if (!c.tograde && !c.toreturn && !asked) {
      parts.push('All Caught Up');
      parts.push('<b>' + GraderWork.returnedThisWeek(cid) + '</b> Returned This Week');
    } else {
      if (c.groups && c.groups === c.tograde)
        parts.push('<b>' + c.groups + '</b> ' + (c.groups === 1 ? 'Group' : 'Groups'));
      // Revisions sent in (S11): "1 Revised", work to grade again.
      if (c.revised) parts.push('<b>' + c.revised + '</b> Revised');
      parts.push('<b>' + c.toreturn + '</b> Not Returned');
      var days = c.oldest
        ? Math.floor((Date.parse(courseToday(cid)) - Date.parse(String(c.oldest).slice(0, 10))) / 86400000)
        : 0;
      if (c.tograde && days >= 7)
        parts.push('<span class="dash-glance-old dash-obs-when is-overdue">Oldest ' + days + ' Days</span>');
      if (asked) parts.push('<b>' + asked + '</b> ' + (asked === 1 ? 'Question' : 'Questions'));
    }
    // With the Inbox on the page a click starts the grading, or with nothing to grade goes to the
    // Inbox (DashInbox.click); the link stays for a new tab.
    var toInbox = !!window.DashInbox;
    return (
      '<a class="dash-glance-cell dash-glance-tograde" role="link" tabindex="0"' +
      (toInbox ? ' data-dash-inbox-jump="1"' : '') +
      ' data-href="' +
      esc('/assignments?course=' + (cid || '') + '&show=tograde') +
      '" aria-label="' +
      esc(
        c.tograde +
          ' to grade, ' +
          (c.revised ? c.revised + ' revised, ' : '') +
          c.toreturn +
          ' not returned' +
          (asked ? ', ' + asked + (asked === 1 ? ' question' : ' questions') : '') +
          (toInbox ? (c.tograde ? ': start grading' : ': go to the Inbox') : ': open Assignments'),
      ) +
      '">' +
      '<span class="dash-glance-label">To Grade</span>' +
      '<span class="dash-glance-value">' +
      c.tograde +
      '</span>' +
      '<span class="dash-glance-sub">' +
      parts.join(' · ') +
      '</span></a>'
    );
  }

  /* ── Questions From Students (S10-F4) ───────────────────────
     The board "Dashboard, Questions From Students": the questions students
     asked on Reflect on Feedback and not answered yet, across the teacher's
     classes, oldest first, each with Answer in the Grader. The list is
     getQuestionsWaiting (shared/data.js), the one the gradebook's dot and
     the Learner Profile's "1 question to answer" read, so one answer in the
     grader clears all three. A question is the student's own words, shown
     as theirs, exactly. '' (no card) when none is waiting, and in every
     class whose student page or Reflect on Feedback is off. */
  function questionsIn(cid) {
    if (typeof getReflectOnFeedback !== 'function' || !getReflectOnFeedback(cid)) return [];
    return getQuestionsWaiting(cid);
  }

  // The question waiting: a follow-up after an answer, or the first one.
  function _waitingWords(r) {
    var follow = !!(r.follow_up && !r.follow_up_answer);
    return {
      text: follow ? r.follow_up : r.question,
      at: follow ? r.sense_now_at || r.sent_at : r.sent_at,
    };
  }

  // The classes to look in: the one shown first, then the others not archived.
  function questionsCardHtml(activeCid) {
    var cids = Object.keys(typeof COURSES === 'object' && COURSES ? COURSES : {}).filter(function (c) {
      return c !== activeCid && !(typeof isCourseArchived === 'function' && isCourseArchived(c));
    });
    if (activeCid) cids.unshift(activeCid);
    var rows = [];
    cids.forEach(function (cid) {
      var students = {};
      (getStudents(cid) || []).forEach(function (s) {
        students[s.id] = s;
      });
      var pieces = {};
      (getAssignedAssessments(cid) || []).forEach(function (a) {
        if (a && a.id) pieces[a.id] = a;
      });
      questionsIn(cid).forEach(function (r) {
        var st = students[r.enrollment_id];
        var a = pieces[r.assessment_id];
        var w = _waitingWords(r);
        if (!st || !a || !w.text) return;
        rows.push({ cid: cid, st: st, a: a, text: w.text, at: String(w.at || '') });
      });
    });
    if (!rows.length) return '';
    rows.sort(function (x, y) {
      return x.at < y.at ? -1 : x.at > y.at ? 1 : 0;
    });
    var html =
      '<section class="dash-overview-section dash-questions" id="dash-questions" aria-labelledby="dash-questions-title">' +
      '<div class="dash-questions-head"><h2 class="dash-section-title" id="dash-questions-title">Questions From Students</h2>' +
      '<span class="dash-questions-count">' +
      rows.length +
      '</span></div>' +
      '<p class="dash-questions-hint">From Reflect on Feedback, across your classes. You answer in the grader, the same as from the Learner Profile.</p>' +
      '<ul class="dash-questions-list">';
    rows.forEach(function (row) {
      var course = COURSES[row.cid] || {};
      var day = row.at ? formatShortDate(row.at.slice(0, 10)) : '';
      var name = displayNameWithLast(row.st);
      html +=
        '<li class="dash-questions-row">' +
        '<span class="dash-questions-av" aria-hidden="true">' +
        esc(initials(row.st)) +
        '</span>' +
        '<div class="dash-questions-body">' +
        '<div class="dash-questions-who">' +
        '<span class="dash-questions-name">' +
        esc(name) +
        '</span>' +
        '<span class="dash-questions-meta">' +
        esc([row.a.title, course.name, day].filter(Boolean).join(' · ')) +
        '</span>' +
        '</div>' +
        '<blockquote class="dash-questions-text">' +
        esc(row.text) +
        '</blockquote>' +
        '<button type="button" class="btn dash-questions-answer" data-action="dashAnswerQuestion" data-cid="' +
        esc(row.cid) +
        '" data-aid="' +
        esc(row.a.id) +
        '" data-sid="' +
        esc(row.st.id) +
        '" aria-label="' +
        esc('Answer ' + name + ' in the grader') +
        '">Answer in the Grader</button>' +
        '</div>' +
        '</li>';
    });
    return html + '</ul></section>';
  }

  /* The bar above the Students heading while a competency is picked: the
     chip that clears it, how the cards are ordered, an observation for the
     students below the Who Needs Help rule on it, and the gradebook on it.
     col: a DashInsights.columns entry; belowIds: those students. */
  function compFilterHtml(cid, col, belowIds) {
    if (!col) return '';
    var n = (belowIds || []).length;
    return (
      '<div class="dash-comp-filter" role="group" aria-label="' +
      esc('Filtered to ' + col.title) +
      '">' +
      '<button type="button" class="dash-comp-chip" data-action="naComp" data-key="" aria-label="' +
      esc('Clear the ' + col.label + ' filter') +
      '">' +
      esc(col.label) +
      '<span aria-hidden="true">×</span></button>' +
      '<span class="dash-comp-filter-note">Weakest first</span>' +
      (n
        ? '<button type="button" class="dash-comp-record" data-action="compRecord" data-key="' +
          esc(col.key) +
          '">' +
          esc('Record an Observation for the ' + n + ' Below') +
          '</button>'
        : '') +
      '<a class="dash-comp-gb" role="link" tabindex="0" data-href="' +
      esc(DashInsights.gradebookHref(cid, [], col)) +
      '">' +
      esc('View ' + col.label + ' in Gradebook →') +
      '</a></div>'
    );
  }

  /* One count of the class's work for one draw, shared by the top bar's To
     Grade cell and the Inbox (D4 follow-up): classWorkCounts goes through
     every piece, and a busy class has dozens. Outside a draw, a plain call.
     The answer is kept by the student list it was asked about: another list
     in the same draw is counted on its own, never given the first's answer. */
  var _draw = null;
  function _idsKey(studentIds) {
    return Array.isArray(studentIds) ? studentIds.map(String).join('\u0001') : String(studentIds);
  }
  function classWorkCounts(cid, studentIds) {
    if (!_draw || _draw.cid !== cid) return GraderWork.classWorkCounts(cid, studentIds);
    var key = _idsKey(studentIds);
    if (!Object.prototype.hasOwnProperty.call(_draw.counts, key))
      _draw.counts[key] = GraderWork.classWorkCounts(cid, studentIds);
    return _draw.counts[key];
  }

  function renderOverviewPanel(opts) {
    _draw = { cid: opts.cid, counts: Object.create(null) };
    try {
      return _renderOverviewPanel(opts);
    } finally {
      _draw = null;
    }
  }

  /* The dashboard under the toolbar: the top bar, then the middle row
     (docs/plans/dashboard-inbox-plan.md, on since D9). The students follow
     (page-dashboard.js), and Observations goes last (obsCardHtml). */
  function _renderOverviewPanel(opts) {
    var cid = opts.cid;
    var allStudents = opts.allStudents;
    var missing = DashInsights.missingItems(cid, allStudents);
    var html = '<div class="dash-section dash-overview">';
    html += glanceHtml(Object.assign({}, opts, { missing: missing }));
    html += rowHtml(opts);
    html += '</div>';
    return html;
  }

  /* ── The middle row (docs/plans/dashboard-inbox-plan.md) ──
     One row: a left column at two thirds and one Competencies tile at one
     third. The row is as tall as the window leaves it, never under 510 px,
     so the Students heading starts below the first view. */
  var ROW_MIN = 510;
  var ROW_GAP = 12;
  // The height last measured, so a redraw starts from it and nothing jumps.
  var _rowH = null;

  /* The row's height: the window's height less where the row starts (on the
     page at scroll 0) and less one gap, never under ROW_MIN. */
  function rowHeight(winH, rowTop) {
    return Math.max(ROW_MIN, Math.round(winH - rowTop - ROW_GAP));
  }

  /* Measures the row on screen, sets its height variable and keeps it for the
     next draw. Where the row starts is read from the row itself, so the
     photo-expiry line above the top bar is counted. */
  function sizeRow() {
    var row = document.querySelector('.dash-row');
    if (!row) return null;
    var main = document.getElementById('main');
    var top = row.getBoundingClientRect().top + (main ? main.scrollTop : 0) + (window.scrollY || 0);
    _rowH = rowHeight(window.innerHeight, top);
    row.style.setProperty('--dash-row-h', _rowH + 'px');
    return _rowH;
  }

  /* The left column: the Inbox slot (the Inbox where the class takes work,
     else Recent Assessments), and under it Bulletins when that is on and
     built (docs/plans/bulletins-plan.md, not built yet). */
  function leftColumnHtml(opts) {
    var cid = opts.cid;
    var bulletins =
      window.BuildFlags && BuildFlags.on('bulletins') && window.DashBulletins ? DashBulletins.html(cid) : '';
    var inboxHome =
      window.DashInbox && window.GraderWork && GraderWork.workOnInClass && GraderWork.workOnInClass(cid)
        ? DashInbox.html(cid, { classCounts: classWorkCounts, bulletins: !!bulletins })
        : DashRecent.html(cid, opts.allStudents || []);
    // The redrawn Inbox with nothing waiting is one line and Bulletins takes the room.
    var quiet = !!(bulletins && window.DashInbox && DashInbox.quiet && DashInbox.quiet());
    return (
      '<div class="dash-row-left' +
      (bulletins ? ' has-bulletins' : '') +
      (quiet ? ' has-quiet-inbox' : '') +
      '"><div class="dash-row-slot dash-row-inbox">' +
      inboxHome +
      '</div>' +
      (bulletins ? '<div class="dash-row-slot dash-row-bulletins">' + bulletins + '</div>' : '') +
      '</div>'
    );
  }

  function rowHtml(opts) {
    return (
      '<div class="dash-row"' +
      (_rowH ? ' style="--dash-row-h:' + _rowH + 'px"' : '') +
      '>' +
      leftColumnHtml(opts) +
      '<div class="dash-row-comp">' +
      DashCompetencies.html(opts) +
      '</div></div>'
    );
  }

  /* The Observations card, at the foot of the page. page-dashboard.js
     re-renders only its inside for its tab and flag clicks. */
  function obsCardHtml(opts) {
    return (
      '<section class="dash-overview-section dash-ob2" id="dash-obs-card" aria-labelledby="dash-ob2-title">' +
      DashObservations.renderCard(opts.cid, opts.allStudents, opts.obs || {}) +
      '</section>'
    );
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

  return {
    renderDashToolbar: renderDashToolbar,
    studentControlsHtml: studentControlsHtml,
    renderOverviewPanel: renderOverviewPanel,
    classWorkCounts: classWorkCounts,
    rowHeight: rowHeight,
    sizeRow: sizeRow,
    obsCardHtml: obsCardHtml,
    glanceHtml: glanceHtml,
    questionsCardHtml: questionsCardHtml,
    compFilterHtml: compFilterHtml,
    obsWeekStart: obsWeekStart,
    obsCoverageWeeks: obsCoverageWeeks,
    obsLastDate: obsLastDate,
    obsIsOverdue: obsIsOverdue,
  };
})();
