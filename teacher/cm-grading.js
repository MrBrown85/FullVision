// @ts-check
/* cm-grading.js — Class Settings: the Grading tab. Moved from teacher/dash-class-manager.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. DashClassManager hands
   over what this file uses through configure(). It loads before dash-class-manager.js. */
/** @type {any} */ (window).CmGrading = (function () {
  'use strict';

  /* Handed over by DashClassManager (configure). */
  var renderClassManager,
    state,
    _cmDefaultGradingSystem,
    _cmRenderCategoriesField,
    _cmRenderLevelOrderField,
    _cmStdCode,
    cmSetFolderCountsAsOne,
    cmSetFoldersCountAsOne,
    cmSetRoundPercent;
  function configure(h) {
    if ('renderClassManager' in h) renderClassManager = h.renderClassManager;
    if ('state' in h) state = h.state;
    if ('_cmDefaultGradingSystem' in h) _cmDefaultGradingSystem = h._cmDefaultGradingSystem;
    if ('_cmRenderCategoriesField' in h) _cmRenderCategoriesField = h._cmRenderCategoriesField;
    if ('_cmRenderLevelOrderField' in h) _cmRenderLevelOrderField = h._cmRenderLevelOrderField;
    if ('_cmStdCode' in h) _cmStdCode = h._cmStdCode;
    if ('cmSetFolderCountsAsOne' in h) cmSetFolderCountsAsOne = h.cmSetFolderCountsAsOne;
    if ('cmSetFoldersCountAsOne' in h) cmSetFoldersCountAsOne = h.cmSetFoldersCountAsOne;
    if ('cmSetRoundPercent' in h) cmSetRoundPercent = h.cmSetRoundPercent;
  }

  /* ── Grading tab ────────────────────────────────────────────
     Grading System on top; under it two lanes, Competency Proficiency (the
     calculation method) and Course Percentage (categories and rounding), and
     beside them Check With a Student, one real student's grade under the
     current settings. A lane the grading system doesn't use is greyed with a
     line saying so. */
  var CM_GRADING_SYSTEMS = [
    { value: 'proficiency', label: 'Proficiency', desc: 'Emerging to Extending, out of 4', sample: '3.0 · Proficient' },
    { value: 'letter', label: 'Letter', desc: 'Letter grade and %', sample: 'B 82%' },
    { value: 'both', label: 'Both', desc: 'Proficiency day to day, letter and % on reports', sample: '3.0 · B 82%' },
  ];
  var CM_METHOD_TEXT = {
    mostRecent: { label: 'Most Recent Score', desc: 'Only the latest score counts.' },
    highest: { label: 'Highest Score', desc: 'The best score counts.' },
    decayingAvg: { label: 'Decaying Average', desc: 'Every score counts; newer ones count more.' },
    average: { label: 'Mean', desc: 'Every score counts the same.' },
    median: { label: 'Median', desc: 'The middle score.' },
    mode: { label: 'Mode', desc: 'The score that comes up most.' },
  };
  var CM_METHOD_ORDER = ['mostRecent', 'highest', 'decayingAvg', 'average', 'median', 'mode'];
  var CM_EXAMPLE_SCORES = [1, 2, 2, 3, 4];
  var _cmCheckSid = {}; // cid -> the student Check With a Student shows

  function _cmMethodRule(method, dw) {
    var w = Math.round(dw * 100);
    switch (method) {
      case 'highest':
        return 'The highest score counts, whenever it was earned.';
      case 'decayingAvg':
        return (
          'Start with the oldest score. Each newer score moves the average: new average = old average × ' +
          (100 - w) +
          '% + new score × ' +
          w +
          '%.'
        );
      case 'average':
        return 'Add the scores and divide by how many there are. An assessment with a higher weight counts more.';
      case 'median':
        return 'Sort the scores and take the middle one. With an even number of scores, take the halfway point between the two middle scores.';
      case 'mode':
        return 'The proficiency that comes up most, counted by whole level, so 3+ and 3 both count as 3. A tie goes to the most recent of the tied scores, keeping its + or −.';
      default:
        return 'The score with the latest date counts. Earlier scores are ignored.';
    }
  }

  // The grading system and calculation method the class shows.
  function _cmKnobs(cid) {
    var course = COURSES[cid];
    var cc = getCourseConfig(cid);
    var method = cc.calcMethod || course.calcMethod || 'average';
    // calc.js counts any method it doesn't know as Most Recent; show that.
    return {
      gs: course.gradingSystem || _cmDefaultGradingSystem(course),
      method: CM_METHOD_TEXT[method] ? method : 'mostRecent',
    };
  }

  function _cmRenderGradingTab(cid) {
    var course = COURSES[cid];
    var cc = getCourseConfig(cid);
    var gs = _cmKnobs(cid).gs;
    var method = _cmKnobs(cid).method;
    var dw = cc.decayWeight != null ? cc.decayWeight : course.decayWeight || 0.65;
    var lastN = getRecentScoreLimit(cid);

    var html =
      '<div class="cm-section">' +
      '<div class="cm-grade-head">' +
      '<div><h2 class="cm-grade-title">Grading System</h2>' +
      '<div class="cm-hint">What students and families see as the grade.</div></div>' +
      '<button type="button" class="cm-action-btn" data-action="cmCopySetup">Copy Grading Setup…</button>' +
      '</div>' +
      '<div class="cm-gs-cards" role="radiogroup" aria-label="Grading system">' +
      CM_GRADING_SYSTEMS.map(function (g) {
        var on = g.value === gs;
        return (
          '<button type="button" class="cm-gs-card' +
          (on ? ' active' : '') +
          '" role="radio" aria-checked="' +
          on +
          '" data-action="cmSetGradingSystem" data-value="' +
          g.value +
          '">' +
          '<span class="cm-gs-name">' +
          g.label +
          '</span>' +
          '<span class="cm-gs-desc">' +
          g.desc +
          '</span>' +
          '<span class="cm-gs-sample">Students see <strong>' +
          g.sample +
          '</strong></span>' +
          '</button>'
        );
      }).join('') +
      '</div>' +
      _cmRenderLevelOrderField(cid) +
      '</div>';

    var profNote =
      gs === 'letter'
        ? '<div class="cm-lane-note">In a Letter class this sets the competency views only. It does not change the %.</div>'
        : '';
    var prof =
      '<div class="cm-section cm-lane">' +
      '<h2 class="cm-grade-title">Competency Proficiency</h2>' +
      '<div class="cm-hint">How each competency’s proficiency comes from a student’s scores.</div>' +
      profNote +
      '<div class="cm-method-head"><span class="cm-label" id="cm-method-label">Calculation Method</span>' +
      '<span class="cm-hint">Example scores, oldest first: ' +
      CM_EXAMPLE_SCORES.join(', ') +
      (lastN && lastN < CM_EXAMPLE_SCORES.length ? ' (the last ' + lastN + ' count)' : '') +
      '</span></div>' +
      '<div class="cm-method-list" role="radiogroup" aria-labelledby="cm-method-label">' +
      CM_METHOD_ORDER.map(function (m) {
        var on = m === method;
        var t = CM_METHOD_TEXT[m];
        return (
          '<button type="button" class="cm-method' +
          (on ? ' active' : '') +
          '" role="radio" aria-checked="' +
          on +
          '" data-action="cmSetCalcMethod" data-value="' +
          m +
          '">' +
          '<span class="cm-method-dot" aria-hidden="true"></span>' +
          '<span class="cm-method-text"><span class="cm-method-name">' +
          t.label +
          '</span><span class="cm-method-desc">' +
          t.desc +
          '</span></span>' +
          '<span class="cm-method-example">' +
          formatLevelAs(null, calcMethodExample(CM_EXAMPLE_SCORES, m, dw, lastN), 'proficiency') +
          '</span>' +
          '</button>'
        );
      }).join('') +
      '</div>' +
      (method === 'decayingAvg'
        ? '<div class="cm-field"><label class="cm-label" for="cm-decay-slider">How Much Newer Work Counts</label>' +
          '<div class="cm-slider-row">' +
          '<input type="range" min="10" max="95" value="' +
          Math.round(dw * 100) +
          '" id="cm-decay-slider" data-action-input="cmDecaySlider" data-action-change="cmDecayCommit" style="flex:1">' +
          '<span class="cm-slider-label" id="cm-decay-val">' +
          Math.round(dw * 100) +
          '%</span></div></div>'
        : '') +
      '<div class="cm-rule-box">' +
      '<div class="cm-rule-title">Exactly How ' +
      CM_METHOD_TEXT[method].label +
      ' Works</div>' +
      '<div class="cm-rule-text" id="cm-method-rule">' +
      esc(_cmMethodRule(method, dw)) +
      '</div>' +
      (lastN && method !== 'mostRecent'
        ? '<div class="cm-rule-text">Only the most recent ' + lastN + ' scores count.</div>'
        : '') +
      '<div class="cm-hint">Every method skips work that hasn’t been scored.</div>' +
      '</div>' +
      _cmRenderRecentLimit(method, lastN) +
      _cmRenderCoursesCountEqually(cid) +
      _cmRenderPointsScale(cid) +
      '</div>';

    var pctOff = gs === 'proficiency';
    var whole = getRoundWholePercent(cid);
    var pct =
      '<div class="cm-section cm-lane' +
      (pctOff ? ' cm-lane-off' : '') +
      '">' +
      '<h2 class="cm-grade-title">Course Percentage</h2>' +
      '<div class="cm-hint">How the letter grade and % come from points and proficiency.</div>' +
      (pctOff
        ? '<div class="cm-lane-note">Not used in a Proficiency class. Choose Letter or Both to turn it on. Your categories stay saved.</div>'
        : '') +
      _cmRenderWeightBar(cid) +
      _cmRenderCategoriesField(cid) +
      '<div class="cm-field">' +
      '<label class="cm-label" for="cm-round-percent">Show the % As</label>' +
      '<select class="cm-input" id="cm-round-percent" data-action-change="cmRoundPercentSelect">' +
      '<option value="whole"' +
      (whole ? ' selected' : '') +
      '>Whole Number (86%)</option>' +
      '<option value="decimal"' +
      (whole ? '' : ' selected') +
      '>One Decimal (85.9%)</option>' +
      '</select>' +
      '<div class="cm-hint">BC report cards for grades 10–12 show a whole %.</div>' +
      '</div>' +
      '<div class="cm-rule-box">' +
      '<div class="cm-rule-title">Exactly How the % Works</div>' +
      '<div class="cm-rule-text">With no categories, the % is total points earned out of total points possible.</div>' +
      '<div class="cm-rule-text">A category with no marked work for a student is left out, and the other categories share its weight.</div>' +
      '<div class="cm-rule-text">A category set to Average of Percentages turns each assessment into a percent first, so each counts the same however many points it has.</div>' +
      '<div class="cm-rule-text">Proficiency work counts as the percent set under Counts As in Points and Proficiency. Proficient counts as ' +
      CmPtsModel.pctText(CmPtsModel.stepValues(getGradingScale(cid))['3']) +
      '% now.</div>' +
      '<div class="cm-rule-text">The letter comes from the % as shown. Shown as a whole number, 85.5% becomes 86% and an A. Shown to one decimal, 85.94% stays 85.9% and a B.</div>' +
      '</div>' +
      '</div>';

    html +=
      '<div class="cm-grade-body">' +
      '<div class="cm-grade-lanes">' +
      prof +
      pct +
      '</div>' +
      _cmRenderCheckStudent(cid, gs, method) +
      '</div>';
    return html;
  }

  var CM_RECENT_LIMITS = [3, 5];

  /* "Count Only the Most Recent": All Scores, or a competency's last 3 or 5.
     Most Recent Score already counts one, so there it does nothing. */
  function _cmRenderRecentLimit(method, lastN) {
    var off = method === 'mostRecent';
    var opts = [{ value: '', label: 'All Scores' }].concat(
      CM_RECENT_LIMITS.map(function (n) {
        return { value: String(n), label: n + ' Scores' };
      }),
    );
    // A limit saved elsewhere that the menu doesn't list still shows.
    if (lastN && CM_RECENT_LIMITS.indexOf(lastN) < 0) opts.push({ value: String(lastN), label: lastN + ' Scores' });
    return (
      '<div class="cm-recent-limit' +
      (off ? ' off' : '') +
      '">' +
      '<span class="cm-recent-text"><label class="cm-label" for="cm-recent-limit">Count Only the Most Recent</label>' +
      '<span class="cm-hint">' +
      (off ? 'Not used with Most Recent Score.' : 'Older scores beyond this number are left out.') +
      '</span></span>' +
      '<select class="cm-input cm-recent-select" id="cm-recent-limit" data-action-change="cmRecentLimit"' +
      (off ? ' disabled' : '') +
      '>' +
      opts
        .map(function (o) {
          return (
            '<option value="' +
            o.value +
            '"' +
            (String(lastN || '') === o.value ? ' selected' : '') +
            '>' +
            o.label +
            '</option>'
          );
        })
        .join('') +
      '</select>' +
      '</div>'
    );
  }

  /* How Folders Count, in the Competencies tab beside the list it changes
     (Colin, Nov 19: the Grading tab's switch was unclear, and he expected
     Humanities 8's ELA folders to count as one while SS 8's competencies
     count on their own). Every folder with competencies, each with its own
     choice: Counts as One (competency_group.counts_as_one) or Each
     Competency. The class switch (course.folders_count_as_one) is kept on
     while any folder counts as one; with every folder on Each Competency
     it is the class's switch off. Not shown until a folder holds
     competencies. */
  function _cmRenderFoldersCountAsOne(cid) {
    var grouped = getGroupedSections(cid);
    var folders = grouped.groups.filter(function (gi) {
      return gi.sections.length > 0;
    });
    if (!folders.length) return '';
    var loose = (grouped.ungrouped || []).length;
    var parts = loose;
    var rows = folders
      .map(function (gi) {
        var g = gi.group || {};
        var one = folderCountsAsOne(cid, g);
        var n = gi.sections.length;
        parts += one ? 1 : n;
        function seg(value, label) {
          var on = (value === 'one') === one;
          return (
            '<button type="button" class="cm-fc-seg' +
            (on ? ' is-on' : '') +
            '" role="radio" aria-checked="' +
            on +
            '" data-action="cmFolderCountChoice" data-grpid="' +
            esc(g.id || '') +
            '" data-value="' +
            value +
            '">' +
            label +
            '</button>'
          );
        }
        return (
          '<div class="cm-fc-row"><span class="cm-fc-name"><span class="cm-fc-title">' +
          esc(g.name || 'Folder') +
          '</span><span class="cm-hint">' +
          n +
          (n === 1 ? ' competency' : ' competencies') +
          ' · ' +
          (one ? '1 part' : n + (n === 1 ? ' part' : ' parts')) +
          '</span></span><span class="cm-fc-segs" role="radiogroup" aria-label="' +
          esc('How ' + (g.name || 'this folder') + ' counts') +
          '">' +
          seg('one', 'As One') +
          seg('each', 'Each') +
          '</span></div>'
        );
      })
      .join('');
    return (
      '<div class="cm-section cm-comp-side-card cm-folder-count-row">' +
      '<h2 class="cm-grade-title">How Folders Count</h2>' +
      '<p class="cm-hint cm-fc-intro">As One: the folder\u2019s competencies are averaged first, and the folder counts as one part of the overall. Each: every competency in it counts as its own part.</p>' +
      rows +
      '<p class="cm-fc-example">The overall has ' +
      parts +
      (parts === 1 ? ' part' : ' parts') +
      (loose ? ', including ' + loose + (loose === 1 ? ' competency' : ' competencies') + ' in no folder' : '') +
      '.</p></div>'
    );
  }

  /* A folder's As One | Each in How Folders Count; the pressed choice keeps the focus. With
     the class switch on, it is the folder's own Counts as One (asks first when grades move).
     With it off every folder counts each competency, so As One turns the switch on with only
     this folder as one: the others go to Each first, which moves nothing while it is off. */
  function cmFolderCountChoice(grpId, value) {
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var one = value === 'one';
    state._cmKeepFocusSel =
      window.CSS && '.cm-fc-seg[data-grpid="' + CSS.escape(grpId) + '"][data-value="' + value + '"]';
    if (getFoldersCountAsOne(cid)) {
      var map = getLearningMap(cid);
      var others = (map.competencyGroups || []).filter(function (g) {
        return g.id !== grpId && g.countsAsOne !== false;
      });
      // The last folder going to Each is the class switch going off.
      if (!one && !others.length) return cmSetFoldersCountAsOne(false);
      return cmSetFolderCountsAsOne(grpId, one);
    }
    if (!one) return;
    var lm = ensureCustomLearningMap(cid);
    (lm.competencyGroups || []).forEach(function (g) {
      g.countsAsOne = g.id === grpId;
    });
    saveLearningMap(cid, lm);
    cmSetFoldersCountAsOne(true);
  }

  /* "Each Course Counts Equally": on, each course in a combined class is
     rolled up on its own and the courses are averaged; off, one roll-up
     across every competency. Shown only when the class has two or more
     courses with competencies. */
  function _cmRenderCoursesCountEqually(cid) {
    var subjectIds = courseSubjectIds(cid);
    if (subjectIds.length < 2) return '';
    var on = getCoursesCountEqually(cid);
    var names = getSubjects(cid)
      .filter(function (s) {
        return subjectIds.indexOf(s.id) >= 0;
      })
      .map(function (s) {
        return s.name;
      });
    var hint = on
      ? names.length === 2
        ? esc(names[0]) + ' and ' + esc(names[1]) + ' each make up half of the overall.'
        : 'Each of the ' + names.length + ' courses makes up an equal share of the overall.'
      : 'A course with more competencies or folders counts for more in the overall.';
    return (
      '<div class="cm-recent-limit cm-folder-count-row">' +
      '<span class="cm-recent-text"><label class="cm-label" for="cm-courses-equal">Each Course Counts Equally</label>' +
      '<span class="cm-hint">' +
      hint +
      '</span></span>' +
      '<span class="gpd-switch"><input type="checkbox" role="switch" id="cm-courses-equal" data-action-change="cmCoursesCountEqually"' +
      (on ? ' checked' : '') +
      '><span class="gpd-switch-ui" aria-hidden="true"></span></span>' +
      '</div>'
    );
  }

  // The Points and Proficiency section: teacher/cm-pts-edit.js.
  function _cmRenderPointsScale(cid) {
    return CmPtsEdit.render(cid);
  }

  // The first reporting term that has already ended, or null.
  function _cmEndedTerm(cid) {
    var today = typeof courseToday === 'function' ? courseToday(cid) : '';
    if (!today) return null;
    return (
      getReportingTerms(cid).find(function (t) {
        return t.ends_on && t.ends_on < today;
      }) || null
    );
  }

  var _cmRenderWeightBar = CmGradingBars.renderWeightBar;

  /* One student's grade with the settings on the left, from the class's own
     scores: the year so far, as the gradebook shows it, even when Class
     // html-safe: the card is built by _cmRenderCheckStudentNow, which escapes every name and number
     Management opens over a report (Colin, 2026-11-03). */
  function _cmRenderCheckStudent(cid, gs, method) {
    // Editing Points and Proficiency, the card reads the draft (or the preset pointed at).
    var draft = CmPtsEdit.shownScale(cid);
    return readAsOfTerm(cid, null, function () {
      if (!draft) return _cmRenderCheckStudentNow(cid, gs, method);
      return withGradingScale(cid, draft, function () {
        return _cmRenderCheckStudentNow(cid, gs, method);
      });
    });
  }

  // The card redrawn in place, while a marker is dragged or a preset pointed at.
  function refreshCheck(cid) {
    var el = document.querySelector('.cm-check');
    if (!el || cid !== state.cmSelectedCourse) return;
    var k = _cmKnobs(cid);
    el.outerHTML = _cmRenderCheckStudent(cid, k.gs, k.method);
  }
  // The competency rows of Check With a Student: each one's scores, then its level.
  function _cmCheckRows(cid, sid, method) {
    var lm = getLearningMap(cid);
    // With "Count Only the Most Recent N", only those N count, so only
    // those are listed (Most Recent Score already counts one).
    var lastN = method !== 'mostRecent' ? getRecentScoreLimit(cid) : null;
    return (lm.sections || [])
      .map(function (sec) {
        var tag = sec.tags && sec.tags[0];
        if (!tag) return '';
        var scores = getCountedTagScores(cid, sid, tag.id)
          .filter(function (s) {
            return s.score > 0;
          })
          .slice()
          .sort(function (a, b) {
            return (a.date || '').localeCompare(b.date || '');
          })
          .map(function (s) {
            if (/** @type {any} */ (s).level != null)
              return formatScoreLevel(/** @type {any} */ (s).level, /** @type {any} */ (s).mod);
            return Number.isInteger(s.score) ? String(s.score) : formatLevelAs(cid, s.score, 'proficiency');
          });
        // The latest few, oldest first, so the method's rule can be followed.
        var shownScores = scores.length > 6 ? ['\u2026'].concat(scores.slice(-6)) : scores;
        var listed = !scores.length
          ? 'No scores yet'
          : lastN && scores.length > lastN
            ? 'Last ' + lastN + ' of ' + scores.length + ' scores: ' + scores.slice(-lastN).join(', ')
            : (scores.length > 6 ? scores.length + ' scores: ' : 'Scores ') + shownScores.join(', ');
        return (
          '<div class="cm-check-row"><span class="cm-check-code">' +
          esc(_cmStdCode(tag)) +
          '</span><span class="cm-check-scores">' +
          esc(listed) +
          '</span><strong class="cm-check-num">' +
          esc(formatLevel(cid, getSectionProficiency(cid, sid, sec.id))) +
          '</strong></div>'
        );
      })
      .join('');
  }

  function _cmRenderCheckStudentNow(cid, gs, method) {
    var students = sortStudents(getStudents(cid), 'lastName');
    var head =
      '<aside class="cm-section cm-check" aria-label="Check with a student">' +
      '<h2 class="cm-grade-title">Check With a Student</h2>' +
      '<div class="cm-hint">One student’s grade with the settings on the left. Change a setting and it updates.</div>';
    if (!students.length) return head + '<div class="cm-hint">Add students to see a grade here.</div></aside>';
    var sid = _cmCheckSid[cid];
    if (
      !students.some(function (s) {
        return s.id === sid;
      })
    )
      sid = students[0].id;
    var summary = studentGradeSummary(cid, sid);
    var notes = CmPtsSave.checkNotes(cid, sid, summary.text || 'No scores yet');
    var html =
      head +
      '<div class="cm-field"><label class="cm-label" for="cm-check-student">Student</label>' +
      '<select class="cm-input" id="cm-check-student" data-action-change="cmCheckStudent">' +
      students
        .map(function (s) {
          return (
            '<option value="' + s.id + '"' + (s.id === sid ? ' selected' : '') + '>' + esc(fullName(s)) + '</option>'
          );
        })
        .join('') +
      '</select></div>' +
      '<div class="cm-check-overall"><span class="cm-check-label">Overall Grade</span>' +
      '<span class="cm-check-value">' +
      esc(summary.text || 'No scores yet') +
      '</span>' +
      notes.was +
      '</div>' +
      notes.moves;

    var rows = _cmCheckRows(cid, sid, method);
    html +=
      '<div class="cm-check-group"><div class="cm-label">Competencies <span class="cm-check-sub">· ' +
      CM_METHOD_TEXT[method].label +
      '</span></div>' +
      (gs === 'letter' ? '<div class="cm-hint">Shown on competency views, not in the %.</div>' : '') +
      (rows || '<div class="cm-hint">No competencies yet.</div>') +
      '</div>';

    if (gs === 'proficiency') {
      html += '<div class="cm-check-group cm-hint">No course % in a Proficiency class.</div>';
    } else {
      var cats = getCategories(cid) || [];
      var scoped = _scopedAssessments(cid);
      var letter = getCourseLetterData(cid, sid);
      var catRows = cats
        .map(function (c) {
          var p = getAssessmentGroupPercentage(
            cid,
            sid,
            scoped.filter(function (a) {
              return (a.categoryId || a.category_id || null) === c.id;
            }),
            categoryCalcMode(c),
          );
          return (
            '<span>' +
            esc(c.name) +
            '</span><span class="cm-check-num">' +
            (p ? formatCoursePercent(cid, p.pct) : '—') +
            '</span><span class="cm-check-num cm-check-weight">' +
            Number(c.weight || 0) +
            '%</span>'
          );
        })
        .join('');
      html +=
        '<div class="cm-check-group"><div class="cm-label">Course % <span class="cm-check-sub">· ' +
        (cats.length ? 'Weighted Categories' : 'Points Earned of Possible') +
        '</span></div>' +
        (cats.length
          ? '<div class="cm-check-cats"><span class="cm-check-colhead">Category</span><span class="cm-check-colhead cm-check-num">Earned</span><span class="cm-check-colhead cm-check-num">Weight</span>' +
            catRows +
            '</div>'
          : '') +
        '<div class="cm-check-total"><strong>Course %</strong><strong>' +
        (letter && letter.R != null
          ? esc((letter.S ? letter.S + ' ' : '') + formatCoursePercent(cid, letter.R))
          : '—') +
        '</strong></div>' +
        '</div>';
    }
    return html + '</aside>';
  }

  function cmCheckStudent(sid) {
    if (!state.cmSelectedCourse) return;
    _cmCheckSid[state.cmSelectedCourse] = sid;
    renderClassManager();
  }

  function cmRoundPercentSelect(value) {
    cmSetRoundPercent(value === 'decimal' ? 'decimal' : 'whole');
  }

  return {
    configure: configure,
    CM_METHOD_TEXT: CM_METHOD_TEXT,
    _cmEndedTerm: _cmEndedTerm,
    _cmMethodRule: _cmMethodRule,
    _cmRenderFoldersCountAsOne: _cmRenderFoldersCountAsOne,
    _cmRenderGradingTab: _cmRenderGradingTab,
    cmBcPointsScale: function () {
      CmPtsEdit.takePreset('bc');
    },
    cmCheckStudent: cmCheckStudent,
    cmFolderCountChoice: cmFolderCountChoice,
    cmMatchPointsScale: function () {
      CmPtsEdit.takePreset('match');
    },
    cmPtsLive: CmPtsEdit.live,
    cmResetPointsScale: function () {
      CmPtsEdit.takePreset('reset');
    },
    cmRoundPercentSelect: cmRoundPercentSelect,
    cmSavePointsScale: CmPtsEdit.savePointsScale,
    refreshCheck: refreshCheck,
  };
})();
