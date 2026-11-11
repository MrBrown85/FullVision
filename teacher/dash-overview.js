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
      '">\u2691 Flagged' +
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
    var html =
      '<section class="dash-glance' +
      (toGrade ? ' has-to-grade' : '') +
      '" aria-label="Class at a Glance"' +
      (toGrade
        ? ' style="grid-template-columns:minmax(0,1.25fr) minmax(0,0.8fr) minmax(0,0.85fr) minmax(0,1.1fr)"'
        : '') +
      '>';

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
     under it, like Missing and Late beside it; the whole cell opens
     Assignments with the To Grade filter on. Its numbers are
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
    var c = GraderWork.classWorkCounts(cid, studentIds);
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
    return (
      '<a class="dash-glance-cell dash-glance-tograde" role="link" tabindex="0" data-href="' +
      esc('/assignments?course=' + (cid || '') + '&show=tograde') +
      '" aria-label="' +
      esc(
        c.tograde +
          ' to grade, ' +
          (c.revised ? c.revised + ' revised, ' : '') +
          c.toreturn +
          ' not returned' +
          (asked ? ', ' + asked + (asked === 1 ? ' question' : ' questions') : '') +
          ': open Assignments',
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

  /* S8-F1: the one-week reminder before the class's photos of student work
     are deleted, at the top of its Dashboard. CmStudentPage owns when it
     shows, its words and Dismiss; '' when it does not show. */
  function photoReminderHtml(cid) {
    if (typeof CmStudentPage === 'undefined' || !CmStudentPage.photoReminderHtml) return '';
    return CmStudentPage.photoReminderHtml(cid, 'dash');
  }

  /* Dismiss, kept on this device for the class and the date it was
     dismissed for (a new date brings the reminder back). Sign-out clears
     it with the other fv- keys. Where storage is blocked it lasts this
     visit only. */
  var PHOTO_DISMISSED_KEY = 'fv-photo-reminder-dismissed:';
  var _photoDismissedHere = {};
  function photoReminderDismissed(cid) {
    if (_photoDismissedHere[cid]) return _photoDismissedHere[cid];
    try {
      return localStorage.getItem(PHOTO_DISMISSED_KEY + cid);
    } catch (e) {
      return null;
    }
  }
  function dismissPhotoReminder(cid, date) {
    try {
      localStorage.setItem(PHOTO_DISMISSED_KEY + cid, date);
    } catch (e) {
      _photoDismissedHere[cid] = date;
    }
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
      (getAssessments(cid) || []).forEach(function (a) {
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
        '<div class="dash-questions-name">' +
        esc(name) +
        '</div>' +
        '<div class="dash-questions-meta">' +
        esc([row.a.title, course.name, day].filter(Boolean).join(' · ')) +
        '</div>' +
        '<blockquote class="dash-questions-text">' +
        esc(row.text) +
        '</blockquote>' +
        '</div>' +
        '<button type="button" class="btn btn-ghost dash-questions-answer" data-action="dashAnswerQuestion" data-cid="' +
        esc(row.cid) +
        '" data-aid="' +
        esc(row.a.id) +
        '" data-sid="' +
        esc(row.st.id) +
        '" aria-label="' +
        esc('Answer ' + name + ' in the grader') +
        '">Answer in the Grader</button>' +
        '</li>';
    });
    return html + '</ul></section>';
  }

  /* ── Curricular Competencies ────────────────────────────────
     Four views behind the view menu (docs/plans/dashboard-cards-plan.md,
     part B), in every grading style:
       avg    Class Average: a bar and the class average per competency
       mix    Level Mix: how many students are at each level
       below  Needs Support: the students below Proficient (the Who Needs
              Help rule) on the most competencies, and where
       trend  Change: the class average month by month
     A Letter class starts on Class Average, a Proficiency or Both class on
     Level Mix; the pick is remembered per class on this device
     (page-dashboard.js). Every view has the same 16 px label row. The card
     sits beside Core Competencies at one height, the taller's (plan F.1):
     its rows share the height between a minimum and a maximum, roomier
     with four rows or fewer (is-roomy), and past 12 rows the list scrolls
     inside the card. A competency row (and a Needs Support column code)
     sets the page's competency filter (data-action naComp; the same key
     again clears it) and, while pointed at, lights its chip on every
     student card; a Level Mix count opens its students (mixSeg); a Needs
     Support row opens the student.

     opts: cid, allStudents, compView, naComp, mixPop, helpRule, belowLists
     (DashInsights.belowLists under the rule, when the caller has them),
     todayStr (tests). */
  var COMP_VIEWS = [
    { key: 'avg', label: 'Class Average', hint: 'The class average on each competency' },
    { key: 'mix', label: 'Level Mix', hint: 'How many students are at each level' },
    // The hint names the Who Needs Help rule's level (_compViews).
    { key: 'below', label: 'Needs Support', hint: 'Students below {level} most often, and where' },
    { key: 'trend', label: 'Change', hint: 'The class average month by month' },
  ];
  var COMP_SUPPORT_ROWS = 7;
  // Past this many rows the list scrolls inside the card (plan F.1).
  var COMP_MAX_ROWS = 12;
  // With this many rows or fewer the card is roomier (plan F.2).
  var COMP_ROOMY_ROWS = 4;
  // Needs Support draws a cell per column up to this many columns, and
  // past it (or below 14 px a column, dashboard.css) each student's codes.
  var COMP_SUPPORT_CELLS = 8;
  var COMP_SUPPORT_CHIPS = 4;
  // Level Mix's one-letter headings on a narrow card (plan F.5).
  var LEVEL_LETTERS = { 1: 'E', 2: 'D', 3: 'P', 4: 'X' };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

  // The views with the Needs Support hint in the rule's words.
  function _compViews(level) {
    return COMP_VIEWS.map(function (v) {
      return { key: v.key, label: v.label, hint: v.hint.replace('{level}', level) };
    });
  }

  /** The view a class's card shows: the saved one, else its grading style's. */
  function compView(cid, saved) {
    var keys = COMP_VIEWS.map(function (v) {
      return v.key;
    });
    if (keys.indexOf(saved) >= 0) return saved;
    return DashInsights.showsProficiency(cid) ? 'mix' : 'avg';
  }

  function _monthName(ym) {
    return MONTHS[Number(String(ym).slice(5, 7)) - 1] || '';
  }

  function _lvl(value) {
    return value > 0 ? Math.max(1, Math.min(4, roundLevel(value))) : 0;
  }

  function _colTitle(col) {
    return col.title + (col.note ? '\n' + col.note : '');
  }

  // The label row: the name column, the middle (cells or plain text), the value column.
  function _compLabels(left, mid, right, midCls, hidden) {
    return (
      '<div class="dash-comp-labels"' +
      (hidden ? ' aria-hidden="true"' : '') +
      '><span class="dash-comp-lab-name">' +
      esc(left) +
      '</span><span class="dash-comp-lab-mid' +
      (midCls ? ' ' + midCls : '') +
      '">' +
      mid +
      '</span><span class="dash-comp-lab-val">' +
      esc(right) +
      '</span></div>'
    );
  }

  // A competency row: a button that sets the filter, or (Level Mix, whose
  // counts are buttons) a row whose name is that button.
  function _compRowOpen(col, picked, aria, inner) {
    return (
      '<button type="button" class="dash-comp-row' +
      (picked ? ' is-picked' : '') +
      '" data-action="naComp" data-key="' +
      esc(col.key) +
      '" aria-pressed="' +
      picked +
      '" aria-label="' +
      esc(aria) +
      '">' +
      inner +
      '</button>'
    );
  }

  function _compName(col) {
    return '<span class="dash-comp-name" title="' + esc(_colTitle(col)) + '">' + esc(col.label) + '</span>';
  }

  function _compAvgRows(cid, cols, dists, comp) {
    return cols
      .map(function (col, i) {
        var avg = dists[i].avg;
        var r = _lvl(avg);
        var text = formatLevel(cid, avg);
        return _compRowOpen(
          col,
          comp === col.key,
          col.title + ': class average ' + (avg > 0 ? text : 'not scored yet'),
          _compName(col) +
            '<span class="dash-outcome-bar-track"><span class="dash-outcome-bar-fill" style="width:' +
            levelBarPercent(cid, avg) +
            '%;background:' +
            (r ? 'var(--score-' + r + ')' : 'var(--divider-subtle)') +
            '"></span></span>' +
            '<span class="dash-comp-val">' +
            esc(text) +
            '</span>',
        );
      })
      .join('');
  }

  function _compMixRows(cid, cols, dists, comp, pop, belowBy, level) {
    var order = levelOrderFor(cid);
    return cols
      .map(function (col, i) {
        var dist = dists[i];
        var counts = dist.bands.map(function (b) {
          return b.ids.length;
        });
        var scored = counts.reduce(function (a, b) {
          return a + b;
        }, 0);
        var top = Math.max.apply(null, counts);
        var k = counts[2] + counts[3];
        var picked = comp === col.key;
        var nBelow = (belowBy[col.key] || []).length;
        var cells = order
          .map(function (l) {
            var b = dist.bands[l - 1];
            var n = b.ids.length;
            if (!n) return '<span class="dash-comp-cell is-empty" title="' + esc('No one ' + b.label) + '">–</span>';
            var on = !!(pop && pop.key === col.key && pop.level === l);
            return (
              '<button type="button" class="dash-mix-seg dash-comp-cell' +
              (n === top ? ' is-top' : '') +
              (on ? ' active' : '') +
              '" data-action="mixSeg" data-key="' +
              esc(col.key) +
              '" data-level="' +
              l +
              '" aria-expanded="' +
              on +
              '" aria-label="' +
              esc(col.title + ': ' + n + ' ' + b.label) +
              '" style="--cell-bg:var(--score-' +
              l +
              '-bg);--cell-fg:var(--score-' +
              l +
              '-text)">' +
              n +
              '</button>'
            );
          })
          .join('');
        return (
          '<div class="dash-comp-row is-mix' +
          (picked ? ' is-picked' : '') +
          '" data-action="naComp" data-key="' +
          esc(col.key) +
          '">' +
          '<button type="button" class="dash-comp-name dash-comp-pick" data-action="naComp" data-key="' +
          esc(col.key) +
          '" data-below="' +
          nBelow +
          '" aria-pressed="' +
          picked +
          '" title="' +
          esc(_colTitle(col)) +
          '" aria-label="' +
          esc(col.title + ': ' + nBelow + ' below ' + level + '. Show the class weakest first on it') +
          '">' +
          esc(col.label) +
          '</button>' +
          '<span class="dash-comp-cells">' +
          cells +
          '</span>' +
          '<span class="dash-comp-val" title="' +
          esc(scored ? k + ' of ' + scored + ' scored students are Proficient or above' : 'Not scored yet') +
          '">' +
          esc(scored ? k + ' of ' + scored : '—') +
          '</span></div>'
        );
      })
      .join('');
  }

  // The students below the rule on at least one competency, most first.
  function _supportPeople(cid, allStudents, lists) {
    var byId = {};
    allStudents.forEach(function (s) {
      byId[s.id] = { student: s, cols: [], below: [] };
    });
    lists.forEach(function (l) {
      l.ids.forEach(function (sid) {
        if (!byId[sid]) return;
        byId[sid].cols.push(l.col);
        byId[sid].below.push({ col: l.col, value: l.values[sid] });
      });
    });
    return sortStudents(allStudents, 'lastName')
      .map(function (s) {
        return byId[s.id];
      })
      .filter(function (p) {
        return p.cols.length > 0;
      })
      .sort(function (a, b) {
        return b.cols.length - a.cols.length;
      });
  }

  // A student's codes in Needs Support's chip form: the columns they are
  // below on, weakest first, at most COMP_SUPPORT_CHIPS, then "+N". On a
  // narrow card only the first two show, with their own "+N"
  // (dashboard.css).
  function _supportChips(cid, p, codes) {
    var below = p.below.slice().sort(function (a, b) {
      return a.value - b.value;
    });
    var html = below
      .slice(0, COMP_SUPPORT_CHIPS)
      .map(function (b, i) {
        var r = _lvl(b.value);
        return (
          '<span class="dash-comp-bchip' +
          (i >= 2 ? ' is-extra' : '') +
          '"' +
          (r ? ' style="background:var(--score-' + r + '-bg);color:var(--score-' + r + '-text)"' : '') +
          ' title="' +
          esc(b.col.title + ': ' + levelText(cid, b.value, 'Not assessed yet')) +
          '">' +
          esc(codes[b.col.key] || '') +
          '</span>'
        );
      })
      .join('');
    var more = below.length - COMP_SUPPORT_CHIPS;
    if (more > 0) html += '<span class="dash-comp-bmore is-wide">+' + more + '</span>';
    if (below.length > 2) html += '<span class="dash-comp-bmore is-narrow">+' + (below.length - 2) + '</span>';
    return '<span class="dash-comp-bchips">' + html + '</span>';
  }

  // cells: whether the rows carry a cell per column (8 columns or fewer;
  // dashboard.css swaps in the chips below 14 px a column).
  function _compSupportRows(cid, cols, people, level, codes, cells) {
    var html = '';
    people.slice(0, COMP_SUPPORT_ROWS).forEach(function (p) {
      var st = p.student;
      var name = DashObservations.rowName(st);
      var full = displayNameWithLast(st);
      var names = p.cols
        .map(function (c) {
          return c.label;
        })
        .join(', ');
      var squares = cells
        ? '<span class="dash-comp-squares" style="--comp-cols:' +
          cols.length +
          '">' +
          cols
            .map(function (col) {
              var v = col.which.groupId
                ? getGroupProficiency(cid, st.id, col.which.groupId)
                : getSectionProficiency(cid, st.id, col.which.sectionId);
              var r = _lvl(v);
              return (
                '<span class="dash-comp-sq' +
                (r ? '' : ' is-none') +
                '"' +
                (r ? ' style="background:var(--score-' + r + ')"' : '') +
                ' title="' +
                esc(col.label + ': ' + levelText(cid, v, 'Not assessed yet')) +
                '"></span>'
              );
            })
            .join('') +
          '</span>'
        : '';
      html +=
        '<a class="dash-comp-row is-student" role="link" tabindex="0" data-href="/student?id=' +
        esc(st.id) +
        '&course=' +
        esc(cid) +
        '&tab=comps" aria-label="' +
        esc(full + ': below ' + level + ' on ' + p.cols.length + ' of ' + cols.length + ', ' + names) +
        '">' +
        '<span class="dash-comp-name" title="' +
        esc(full) +
        '">' +
        esc(name) +
        '</span>' +
        '<span class="dash-comp-mid">' +
        squares +
        _supportChips(cid, p, codes) +
        '</span>' +
        '<span class="dash-comp-val">' +
        esc(p.cols.length + ' of ' + cols.length) +
        '</span>' +
        '<span class="dist-tip dash-comp-tip" aria-hidden="true"><span class="dist-tip-title">' +
        esc(full) +
        '</span><span class="dash-comp-tip-line">' +
        esc('Below on ' + names) +
        '</span></span></a>';
    });
    var more = people.length - COMP_SUPPORT_ROWS;
    if (more > 0)
      html +=
        '<button type="button" class="dash-comp-more" data-action="studentView" data-view="grid">+' +
        more +
        ' more</button>';
    if (!people.length)
      html +=
        '<div class="dash-comp-none">' +
        esc('Everyone is at ' + level + ' or above, or has too few scores to say.') +
        '</div>';
    return html;
  }

  function _compTrendRows(cid, cols, series, comp) {
    // Every row on one time line (the months any competency has) and one
    // vertical scale, so the lines can be compared.
    var months = [];
    var lo = Infinity;
    var hi = -Infinity;
    series.forEach(function (s) {
      s.forEach(function (m) {
        if (months.indexOf(m.month) < 0) months.push(m.month);
        var y = levelBarPercent(cid, m.avg);
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      });
    });
    months.sort();
    if (hi - lo < 10) {
      var mid = (hi + lo) / 2;
      lo = mid - 5;
      hi = mid + 5;
    }
    var span = Math.max(1, months.length - 1);
    var round1 = function (n) {
      return Math.round(n * 10) / 10;
    };
    var rows = cols
      .map(function (col, i) {
        var s = series[i];
        var picked = comp === col.key;
        var tipLine;
        var line = '';
        var val = '—';
        var cls = '';
        if (s.length < 2) {
          tipLine = 'Not enough months yet';
        } else {
          tipLine = s
            .map(function (m) {
              return _monthName(m.month) + ' ' + formatLevel(cid, m.avg);
            })
            .join(' · ');
          var move = levelMoveText(cid, s[0].avg, s[s.length - 1].avg);
          var up = !move || move.dir >= 0;
          val = move ? move.text : '—';
          cls = up ? ' is-up' : ' is-down';
          var pts = s
            .map(function (m) {
              var x = months.length > 1 ? (months.indexOf(m.month) / span) * 100 : 50;
              var y = 16 - ((levelBarPercent(cid, m.avg) - lo) / (hi - lo)) * 14;
              return round1(x) + ',' + round1(y);
            })
            .join(' ');
          line =
            '<svg class="dash-comp-spark" viewBox="0 0 100 18" preserveAspectRatio="none" aria-hidden="true" focusable="false"><polyline points="' +
            pts +
            '" fill="none" stroke="' +
            (up ? 'var(--score-3)' : 'var(--score-1)') +
            '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>';
        }
        return _compRowOpen(
          col,
          picked,
          col.title + ': ' + tipLine,
          _compName(col) +
            '<span class="dash-comp-line">' +
            line +
            '</span>' +
            '<span class="dash-comp-val' +
            cls +
            '">' +
            esc(val) +
            '</span>' +
            '<span class="dist-tip dash-comp-tip" aria-hidden="true"><span class="dist-tip-title">' +
            esc(col.title) +
            '</span><span class="dash-comp-tip-line">' +
            esc(tipLine) +
            '</span></span>',
        );
      })
      .join('');
    return { rows: rows, first: months[0], last: months[months.length - 1] };
  }

  function competenciesCardHtml(opts) {
    var cid = opts.cid;
    var allStudents = opts.allStudents || [];
    var ids = allStudents.map(function (s) {
      return s.id;
    });
    var view = compView(cid, opts.compView);
    var cols = DashInsights.columns(cid);
    var codes = DashInsights.columnCodes(cid, cols);
    var comp = opts.naComp || null;
    var rule = DashInsights.readRule(opts.helpRule);
    var level = DashInsights.ruleLevelName(rule);
    var lists = opts.belowLists || DashInsights.belowLists(cid, allStudents, rule);
    var belowBy = {};
    lists.forEach(function (l) {
      belowBy[l.col.key] = l.ids;
    });
    var dists = cols.map(function (col) {
      return competencyDistribution(cid, ids, col.which);
    });

    var labels;
    var rows;
    // How many rows this view draws (the card's density follows it), and
    // the card's classes for Needs Support's two forms.
    var nRows = cols.length;
    var cardCls = '';
    if (!cols.length) {
      labels = _compLabels('Competency', '', '', '', true);
      rows = '<div class="dash-comp-none">No competencies in this class yet.</div>';
      nRows = 0;
    } else if (view === 'mix') {
      var heads = levelOrderFor(cid)
        .map(function (l) {
          // The level's short code (EXT, PRF …), as the student list's key
          // shows it, or on a narrow card one letter; the name is in the
          // title.
          return (
            '<span title="' +
            esc(dists[0].bands[l - 1].label) +
            '"><span class="dash-comp-lv-long">' +
            esc(levelCode(l)) +
            '</span><span class="dash-comp-lv-short">' +
            esc(LEVEL_LETTERS[l]) +
            '</span></span>'
          );
        })
        .join('');
      labels = _compLabels('Competency', heads, 'Prof.+', 'is-cells', true);
      rows = _compMixRows(cid, cols, dists, comp, opts.mixPop, belowBy, level);
    } else if (view === 'below') {
      var people = _supportPeople(cid, allStudents, lists);
      var cells = cols.length <= COMP_SUPPORT_CELLS;
      cardCls = cells ? ' ns-cols-' + cols.length : ' is-chipform';
      var codeBtns = cells
        ? cols
            .map(function (col) {
              var picked = comp === col.key;
              return (
                '<button type="button" class="dash-comp-code' +
                (picked ? ' is-picked' : '') +
                '" data-action="naComp" data-key="' +
                esc(col.key) +
                '" aria-pressed="' +
                picked +
                '" title="' +
                esc(col.title) +
                '" aria-label="' +
                esc(col.title + ': show the class weakest first on it') +
                '">' +
                esc(codes[col.key]) +
                '</button>'
              );
            })
            .join('')
        : '';
      // Two label rows, one per form; dashboard.css shows the one in use.
      labels =
        (cells
          ? '<div class="dash-comp-labels is-cells-form"><span class="dash-comp-lab-name">Student</span>' +
            '<span class="dash-comp-lab-mid dash-comp-codes" style="--comp-cols:' +
            cols.length +
            '">' +
            codeBtns +
            '</span><span class="dash-comp-lab-val">Below</span></div>'
          : '') +
        _compLabels('Student', '<span>Below on</span>', 'Count', '', true).replace(
          'class="dash-comp-labels"',
          'class="dash-comp-labels is-chips-form"',
        );
      rows = _compSupportRows(cid, cols, people, level, codes, cells);
      nRows = Math.min(COMP_SUPPORT_ROWS, people.length) + (people.length > COMP_SUPPORT_ROWS ? 1 : 0);
    } else if (view === 'trend') {
      var t = _compTrendRows(
        cid,
        cols,
        cols.map(function (col) {
          return competencyMonthlyAverages(cid, ids, col.which, opts.todayStr);
        }),
        comp,
      );
      labels = _compLabels(
        'Competency',
        t.first && t.last && t.first !== t.last
          ? '<span>' + esc(_monthName(t.first)) + '</span><span>' + esc(_monthName(t.last)) + '</span>'
          : '',
        'Change',
        'is-ends',
        true,
      );
      rows = t.rows;
    } else {
      labels = _compLabels('Competency', '', 'Average', '', true);
      rows = _compAvgRows(cid, cols, dists, comp);
    }
    // Past COMP_MAX_ROWS the list scrolls inside the card, a fade at its
    // foot and "+N more" under it (page-dashboard.js keeps N current).
    var scroll = view !== 'below' && nRows > COMP_MAX_ROWS;
    var roomy = nRows > 0 && nRows <= COMP_ROOMY_ROWS;

    var html =
      '<section class="dash-overview-section dash-comp-card' +
      (roomy ? ' is-roomy' : '') +
      cardCls +
      '" aria-labelledby="dash-comp-title" data-view="' +
      view +
      '">' +
      '<div class="dash-section-title dash-comp-head"><span id="dash-comp-title">Curricular Competencies</span>' +
      viewMenuHtml({ id: 'comp', label: 'Curricular Competencies view', views: _compViews(level), current: view }) +
      '<a role="link" tabindex="0" data-href="/gradebook?course=' +
      esc(cid) +
      '">View Gradebook →</a></div>' +
      '<div class="dash-comp-body">' +
      labels +
      (scroll ? '<div class="dash-comp-scroll">' : '') +
      '<div class="dash-comp-rows' +
      (scroll ? ' is-scroll' : '') +
      '" aria-label="Curricular competencies"' +
      (scroll ? ' tabindex="0"' : '') +
      '>' +
      rows +
      '</div>' +
      (scroll
        ? '</div><button type="button" class="dash-comp-moreline" data-action="compMore" aria-label="' +
          esc('Scroll to the other ' + (nRows - COMP_MAX_ROWS) + ' competencies') +
          '">+' +
          (nRows - COMP_MAX_ROWS) +
          ' more</button>'
        : '') +
      '</div>';
    // No footer line (Colin, Nov 5): the view menu's hints and the row
    // pop-ups say what the card shows.
    return html + '</section>';
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

  /* ── The view menu ─────────────────────────────────────────
     One pill-and-menu for every dashboard card that has views (Core
     Competencies registers 'core', Curricular Competencies 'comp'):

       viewMenuHtml({ id, label, views: [{ key, label, hint }], current })

     id: a short key, unique on the page. label: what the menu picks, for
     screen readers ("Core Competencies view"). views: in menu order; hint is
     the plain sentence under the name. current: the key in use (the first
     view when it matches none). The menu is drawn closed.

     page-dashboard.js runs it: data-action="viewMenu" data-menu=id on the
     pill opens and closes it; data-action="viewPick" data-menu=id
     data-view=key on an item calls the setter the page registered as
     _viewSetters[id](key), re-renders and puts focus back on the pill.
     Arrow keys, Home and End move between the items, Enter picks, Escape and
     a click outside close it. */
  var VIEW_CARET =
    '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.5l3 3 3-3"/></svg>';

  function viewMenuHtml(o) {
    var views = o.views || [];
    var cur =
      views.filter(function (v) {
        return v.key === o.current;
      })[0] || views[0];
    if (!cur) return '';
    var id = String(o.id);
    var html =
      '<span class="dash-view-wrap">' +
      '<button type="button" class="dash-view-btn" id="dash-view-btn-' +
      esc(id) +
      '" aria-haspopup="menu" aria-expanded="false" aria-controls="dash-view-menu-' +
      esc(id) +
      '" aria-label="' +
      esc((o.label ? o.label + ': ' : '') + cur.label) +
      '" data-action="viewMenu" data-menu="' +
      esc(id) +
      '">' +
      '<span>' +
      esc(cur.label) +
      '</span>' +
      VIEW_CARET +
      '</button>' +
      '<div class="dash-view-menu" id="dash-view-menu-' +
      esc(id) +
      '" role="menu" aria-label="' +
      esc(o.label || '') +
      '" hidden>';
    views.forEach(function (v) {
      var on = v === cur;
      html +=
        '<button type="button" class="dash-view-item' +
        (on ? ' is-on' : '') +
        '" role="menuitemradio" aria-checked="' +
        on +
        '" tabindex="-1" data-action="viewPick" data-menu="' +
        esc(id) +
        '" data-view="' +
        esc(v.key) +
        '">' +
        '<span class="dash-view-tick" aria-hidden="true">' +
        (on ? '✓' : '') +
        '</span>' +
        '<span class="dash-view-text"><span class="dash-view-name">' +
        esc(v.label) +
        '</span>' +
        (v.hint ? '<span class="dash-view-hint">' + esc(v.hint) + '</span>' : '') +
        '</span></button>';
    });
    return html + '</div></span>';
  }

  /* ── Core Competencies ──────────────────────────────────────
     Two views (docs/plans/dashboard-cards-plan.md, part C):
     Self-Assessment, one square per student in a light-to-dark blue for the
     step they gave this term (their view, never a grade), grey for those who
     haven't; and Evidence, one square per assessment (dark) and per
     observation (light) tagged with it. With no self-assessment in the class
     this term there is only Evidence, and the link sets up a reflection.
     Rows sit in their groups (Communication, Thinking, Personal & Social)
     beside a thin bar; the card is the same height in every view.

     opts: cid, allStudents, ccCounts and ccAssessments (tagged assessments),
     ccObs (tagged observations per core id), coreSelf (coreSelfRatings in
     shared/core-self.js) and coreView ('self' or 'evidence'). */
  var CORE_VIEWS = [
    { key: 'self', label: 'Self-Assessment', hint: 'How students rated themselves this term' },
    { key: 'evidence', label: 'Evidence', hint: 'Work and observations tagged with each' },
  ];
  var CORE_TIP_NAMES = 8;
  var CORE_TIP_TITLES = 10;

  function coreView(opts) {
    var hasSelf = !!(opts.coreSelf && opts.coreSelf.any);
    return hasSelf && opts.coreView !== 'evidence' ? 'self' : 'evidence';
  }

  function _coreGroups() {
    var groups = [];
    CORE_COMPETENCIES.forEach(function (cc) {
      var g = groups[groups.length - 1];
      if (!g || g.name !== cc.group) groups.push((g = { name: cc.group, items: [] }));
      g.items.push(cc);
    });
    return groups;
  }

  function _coreSquare(cls, title) {
    return '<span class="dash-core-sq ' + cls + '" title="' + esc(title) + '"></span>';
  }

  function _coreSelfRow(cid, cc, students, ratings) {
    var n = students.length;
    var byLevel = { 1: [], 2: [], 3: [], 4: [] };
    var notYet = [];
    students.forEach(function (s) {
      var lv = ratings[s.id];
      if (byLevel[lv]) byLevel[lv].push(s);
      else notYet.push(s);
    });
    var k = n - notYet.length;
    var squares = '';
    [4, 3, 2, 1].forEach(function (lv) {
      byLevel[lv].forEach(function (s) {
        squares += _coreSquare('is-self-' + lv, displayName(s) + ': ' + CONFIDENCE_LABELS[lv]);
      });
    });
    notYet.forEach(function (s) {
      squares += _coreSquare('is-none', displayName(s) + ': not yet');
    });
    var mix = [4, 3, 2, 1]
      .map(function (lv) {
        return CONFIDENCE_LABELS[lv] + ' ' + byLevel[lv].length;
      })
      .join(' · ');
    var names = notYet.slice(0, CORE_TIP_NAMES).map(displayName).join(', ');
    var more = notYet.length - CORE_TIP_NAMES;
    var notYetLine = notYet.length ? 'Not yet: ' + names + (more > 0 ? ', +' + more + ' more' : '') : '';
    return {
      squares: squares,
      value: k + ' of ' + n,
      amber: k * 3 < n * 2,
      empty: false,
      label: cc.label + ': ' + k + ' of ' + n + ' have self-assessed. ' + mix,
      tip:
        '<div class="dash-core-tip-line">' +
        esc(mix) +
        '</div>' +
        (notYetLine
          ? '<div class="dash-core-tip-line is-quiet">' +
            esc(notYetLine) +
            '</div>' +
            // Someone hasn't self-assessed: the questionnaire is one click
            // away (plan F.7b).
            '<a class="dash-core-tip-link" role="link" tabindex="0" data-href="' +
            esc('/dashboard?course=' + cid + '&manage=questionnaires') +
            '">Open the Questionnaire →</a>'
          : ''),
    };
  }

  function _coreEvidenceRow(cc, opts) {
    var titles = (opts.ccAssessments && opts.ccAssessments[cc.id]) || [];
    var nA = (opts.ccCounts && opts.ccCounts[cc.id]) || titles.length;
    var nO = (opts.ccObs && opts.ccObs[cc.id]) || 0;
    var total = nA + nO;
    var squares = '';
    for (var i = 0; i < nA; i++) squares += _coreSquare('is-work', titles[i] || 'Assessment');
    for (var j = 0; j < nO; j++) squares += _coreSquare('is-obs', 'Observation');
    var obsLine = nO ? nO + ' observation' + (nO === 1 ? '' : 's') : '';
    var tip;
    if (!total)
      tip = '<div class="dash-core-tip-line is-quiet">Tag work in Assignments, or an observation with + Add Tag</div>';
    else {
      var more = titles.length - CORE_TIP_TITLES;
      tip =
        titles
          .slice(0, CORE_TIP_TITLES)
          .map(function (t) {
            return '<div class="dist-tip-name">' + esc(t) + '</div>';
          })
          .join('') +
        (more > 0 ? '<div class="dash-core-tip-line is-quiet">+' + more + ' more</div>' : '') +
        (obsLine ? '<div class="dash-core-tip-line is-quiet">' + esc(obsLine) + '</div>' : '');
    }
    var parts = [];
    if (nA) parts.push(nA + ' assessment' + (nA === 1 ? '' : 's'));
    if (obsLine) parts.push(obsLine);
    return {
      squares: squares,
      value: total ? String(total) : 'None yet',
      amber: !total,
      empty: !total,
      label: cc.label + ': ' + (parts.length ? parts.join(' and ') + ' tagged' : 'nothing tagged yet'),
      tip: tip,
    };
  }

  function coreCardHtml(opts) {
    var cid = opts.cid;
    var hasSelf = !!(opts.coreSelf && opts.coreSelf.any);
    var view = coreView(opts);
    var href =
      view === 'evidence' && hasSelf
        ? '/assignments?course=' + cid
        : '/dashboard?course=' + cid + '&manage=questionnaires';
    var linkText = !hasSelf ? 'Set Up a Reflection →' : view === 'self' ? 'Questionnaires →' : 'Assignments →';
    var html =
      '<section class="dash-overview-section dash-core-card" aria-labelledby="dash-core-title">' +
      '<div class="dash-section-title dash-core-head"><span id="dash-core-title">Core Competencies</span>' +
      (hasSelf
        ? viewMenuHtml({ id: 'core', label: 'Core Competencies view', views: CORE_VIEWS, current: view })
        : '<span class="dash-core-sub">Evidence</span>') +
      '<a role="link" tabindex="0" data-href="' +
      esc(href) +
      '">' +
      esc(linkText) +
      '</a></div>' +
      '<div class="dash-core-list dash-core-' +
      view +
      '">';
    var students = typeof sortStudents === 'function' ? sortStudents(opts.allStudents || [], 'lastName') : [];
    // The groups share the card's height with the gaps between them
    // (plan F.2): each group grows by its number of rows, each gap
    // between 8 and 20 px.
    _coreGroups().forEach(function (g, gi) {
      if (gi) html += '<span class="dash-core-gap" aria-hidden="true"></span>';
      html +=
        '<div class="dash-core-group" role="group" style="--core-rows:' +
        g.items.length +
        '" aria-label="' +
        esc(g.name) +
        '"><span class="dash-core-gbar" title="' +
        esc(g.name) +
        '" aria-hidden="true"></span><div class="dash-core-rows">';
      g.items.forEach(function (cc) {
        var row =
          view === 'self'
            ? _coreSelfRow(cid, cc, students, opts.coreSelf.byCore[cc.id] || {})
            : _coreEvidenceRow(cc, opts);
        html +=
          '<div class="dash-core-row' +
          (row.empty ? ' is-empty' : '') +
          '" data-core="' +
          esc(cc.id) +
          '">' +
          '<span class="dash-core-name" title="' +
          esc(cc.label) +
          '">' +
          esc(cc.label) +
          '</span>' +
          '<span class="dash-core-squares" role="img" aria-label="' +
          esc(row.label) +
          '">' +
          row.squares +
          '</span>' +
          '<span class="dash-core-val' +
          (row.amber ? ' is-amber' : '') +
          '">' +
          esc(row.value) +
          '</span>' +
          '<div class="dist-tip dash-core-tip"><div class="dist-tip-title">' +
          esc(cc.label + ' · ' + g.name) +
          '</div>' +
          row.tip +
          '</div></div>';
      });
      html += '</div></div>';
    });
    return html + '</div></section>';
  }

  /* The dashboard under the toolbar: the top bar, then Curricular and Core
     Competencies side by side at one height (Colin, Nov 5: Needs Attention
     is gone). The students follow (page-dashboard.js), and Observations
     goes last (obsCardHtml) until Colin decides its place. */
  function renderOverviewPanel(opts) {
    var cid = opts.cid;
    var allStudents = opts.allStudents;
    var missing = DashInsights.missingItems(cid, allStudents);
    var html = '<div class="dash-section dash-overview">';
    html += glanceHtml(Object.assign({}, opts, { missing: missing }));
    html +=
      '<div class="dash-overview-row dash-overview-cards">' +
      competenciesCardHtml(opts) +
      coreCardHtml(opts) +
      '</div>';
    html += '</div>';
    return html;
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
        esc(initials(b.student)) +
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
    studentControlsHtml: studentControlsHtml,
    renderOverviewPanel: renderOverviewPanel,
    obsCardHtml: obsCardHtml,
    glanceHtml: glanceHtml,
    questionsCardHtml: questionsCardHtml,
    photoReminderHtml: photoReminderHtml,
    photoReminderDismissed: photoReminderDismissed,
    dismissPhotoReminder: dismissPhotoReminder,
    viewMenuHtml: viewMenuHtml,
    competenciesCardHtml: competenciesCardHtml,
    compView: compView,
    compFilterHtml: compFilterHtml,
    coreCardHtml: coreCardHtml,
    coreView: coreView,
    renderBirthdayWidget: renderBirthdayWidget,
    obsWeekStart: obsWeekStart,
    obsCoverageWeeks: obsCoverageWeeks,
    obsLastDate: obsLastDate,
    obsIsOverdue: obsIsOverdue,
  };
})();
