// @ts-check
/* cm-grading.js — Class Settings: the Grading tab. Moved from teacher/dash-class-manager.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. DashClassManager hands
   over what this file uses through configure(). It loads before dash-class-manager.js. */
/** @type {any} */ (window).CmGrading = (function () {
  'use strict';

  /* Handed over by DashClassManager (configure). */
  var renderClassManager,
    state,
    _addDocListener,
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
    if ('_addDocListener' in h) _addDocListener = h._addDocListener;
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

  function _cmRenderGradingTab(cid) {
    var course = COURSES[cid];
    var cc = getCourseConfig(cid);
    var gs = course.gradingSystem || _cmDefaultGradingSystem(course);
    var method = cc.calcMethod || course.calcMethod || 'average';
    // calc.js counts any method it doesn't know as Most Recent; show that.
    if (!CM_METHOD_TEXT[method]) method = 'mostRecent';
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
      _cmPctText(_cmStepValues(getGradingScale(cid))['3']) +
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

  // Markers closer than this (in % of the ruler) go on two rows: a pill's
  // width on the narrowest ruler (.cm-pts-ruler's min-width, 420px).
  var CM_PTS_CLOSE = 7.6;
  var CM_PTS_TICKS = [0, 25, 50, 75, 100];

  function _cmStepId(key) {
    return key.replace('+', 'p').replace('-', 'm');
  }
  // 2- reads 2−.
  function _cmStepLabel(key) {
    return key.replace('-', '−');
  }
  // Every step's percent, keyed as COUNTS_AS_STEPS.
  function _cmStepValues(scale) {
    var list = countsAsStepPercents(scale && scale.percents);
    var out = {};
    COUNTS_AS_STEPS.forEach(function (step, i) {
      out[step.key] = list[i];
    });
    return out;
  }
  function _cmHasOwnStep(scale, key) {
    var p = scale && scale.percents;
    return !!p && p[key] != null && p[key] !== '';
  }
  // The percents a save writes: every whole level, and each + or − that has
  // a value of its own.
  function _cmOwnPercents(scale) {
    var saved = _cmStepValues(scale);
    var out = {};
    COUNTS_AS_STEPS.forEach(function (step) {
      if (step.key.length === 1 || _cmHasOwnStep(scale, step.key)) out[step.key] = saved[step.key];
    });
    return out;
  }
  // Where each proficiency starts on a points score: { 1: 0, 2: 50, 3: 73, 4: 86 }.
  function _cmStarts(scale) {
    var at = { 1: 0 };
    ((scale && scale.boundaries) || DEFAULT_GRADING_SCALE.boundaries).forEach(function (row) {
      if (row.proficiency > 1) at[row.proficiency] = Number(row.min) || 0;
    });
    return at;
  }
  // One decimal at most: 91.7, 86.
  function _cmPctText(v) {
    return String(Math.round(v * 10) / 10);
  }
  function _cmPtsLeft(v) {
    return Math.max(0, Math.min(100, v)) + '%';
  }

  // Row 0 or 1 for each marker, lowest first: one too close to the last
  // marker on the top row drops to the second.
  function _cmPtsRows(values) {
    var last = [-Infinity, -Infinity];
    return values.map(function (v) {
      var row = v - last[0] >= CM_PTS_CLOSE ? 0 : v - last[1] >= CM_PTS_CLOSE ? 1 : last[0] <= last[1] ? 0 : 1;
      last[row] = v;
      return row;
    });
  }

  function _cmPtsPicked(cid) {
    return state._cmPtsPick && state._cmPtsPick.cid === cid ? state._cmPtsPick : null;
  }
  function _cmPtsSame(a, b) {
    return !!a && !!b && a.kind === b.kind && (a.kind === 'step' ? a.key === b.key : a.level === b.level);
  }
  function _cmPtsPickId(p) {
    return p.kind === 'step' ? 'cm-pts-step-' + _cmStepId(p.key) : 'cm-pts-edge-' + p.level;
  }
  // The marker or handle a button stands for, or null.
  function _cmPtsFromEl(cid, el) {
    var d = (el && el.dataset) || {};
    if (d.kind === 'step') {
      var ok = COUNTS_AS_STEPS.some(function (s) {
        return s.key === d.key;
      });
      return ok ? { cid: cid, kind: 'step', key: d.key } : null;
    }
    var level = parseInt(d.level, 10);
    return d.kind === 'edge' && level >= 2 && level <= 4 ? { cid: cid, kind: 'edge', level: level } : null;
  }
  function _cmPtsValue(cid, p) {
    var scale = getGradingScale(cid);
    return p.kind === 'step' ? _cmStepValues(scale)[p.key] : _cmStarts(scale)[p.level];
  }
  // How far a drag can take it: between its neighbours.
  function _cmPtsRange(cid, p) {
    var scale = getGradingScale(cid);
    if (p.kind === 'edge') {
      var at = _cmStarts(scale);
      return [at[p.level - 1] + 1, p.level === 4 ? 99 : at[p.level + 1] - 1];
    }
    var list = countsAsStepPercents(scale.percents);
    var i = COUNTS_AS_STEPS.findIndex(function (s) {
      return s.key === p.key;
    });
    var lo = i > 0 ? list[i - 1] + 0.1 : 0;
    var hi = i < list.length - 1 ? list[i + 1] - 0.1 : 100;
    return [Math.ceil(lo * 10) / 10, Math.floor(hi * 10) / 10];
  }

  function _cmRenderPointsScale(cid) {
    var scale = getGradingScale(cid);
    var steps = _cmStepValues(scale);
    var at = _cmStarts(scale);
    var pick = _cmPtsPicked(cid);
    // The scale's own legend: each band and handle names its proficiency.
    var names = {};
    [1, 2, 3, 4].forEach(function (l) {
      names[l] = PROF_LABELS[l];
    });
    var values = COUNTS_AS_STEPS.map(function (s) {
      return steps[s.key];
    });
    var rows = _cmPtsRows(values);
    var markers = COUNTS_AS_STEPS.map(function (s, i) {
      var key = s.key;
      var v = values[i];
      var on = !!pick && pick.kind === 'step' && pick.key === key;
      var name = _cmStepLabel(key) + ' counts as ' + _cmPctText(v) + '%';
      // A whole level that reads back as another level is flagged, not
      // blocked (DECISIONS, "Proficiency percents"): its marker sits over
      // that level's band, and its name says so.
      if (key.length === 1) {
        var readsAs = pointsToProf(v, 100, scale);
        if (readsAs !== Number(key)) name += ', which shows as ' + names[readsAs];
      }
      return (
        '<div class="cm-pts-marker lv-' +
        key.charAt(0) +
        (rows[i] ? ' is-low' : '') +
        (on ? ' is-on' : '') +
        '" data-key="' +
        esc(key) +
        '" style="left:' +
        _cmPtsLeft(v) +
        '">' +
        '<button type="button" class="cm-pts-pill' +
        (on ? ' is-on' : '') +
        '" id="cm-pts-step-' +
        _cmStepId(key) +
        '" data-action="cmPtsPick" data-kind="step" data-key="' +
        esc(key) +
        '" aria-pressed="' +
        on +
        '" aria-label="' +
        esc(name) +
        '" title="' +
        esc(name) +
        '">' +
        esc(_cmStepLabel(key)) +
        '</button><span class="cm-pts-stem" aria-hidden="true"></span></div>'
      );
    }).join('');
    var cuts = [0, at[2], at[3], at[4], 100];
    var bands = [1, 2, 3, 4]
      .map(function (l) {
        return (
          '<span class="cm-pts-band lv-' +
          l +
          '" data-lv="' +
          l +
          '" style="width:' +
          Math.max(0, cuts[l] - cuts[l - 1]) +
          '%">' +
          esc(names[l]) +
          '</span>'
        );
      })
      .join('');
    var edges = [2, 3, 4]
      .map(function (l) {
        var on = !!pick && pick.kind === 'edge' && pick.level === l;
        var name = names[l] + ' starts at ' + at[l] + '%';
        return (
          '<div class="cm-pts-edge' +
          (on ? ' is-on' : '') +
          '" data-level="' +
          l +
          '" style="left:' +
          _cmPtsLeft(at[l]) +
          '"><span class="cm-pts-edge-line" aria-hidden="true"></span>' +
          '<button type="button" class="cm-pts-handle' +
          (on ? ' is-on' : '') +
          '" id="cm-pts-edge-' +
          l +
          '" data-action="cmPtsPick" data-kind="edge" data-level="' +
          l +
          '" aria-pressed="' +
          on +
          '" aria-label="' +
          esc(name) +
          '" title="' +
          esc(name) +
          '">' +
          esc(at[l] + '%') +
          '</button></div>'
        );
      })
      .join('');
    var ticks = CM_PTS_TICKS.map(function (t) {
      return '<span style="left:' + t + '%">' + t + '%</span>';
    }).join('');
    var edit = '';
    if (pick) {
      var isStep = pick.kind === 'step';
      var value =
        state._cmPtsTyped != null ? state._cmPtsTyped : isStep ? _cmPctText(steps[pick.key]) : String(at[pick.level]);
      edit =
        '<label class="cm-pts-edit-label" for="cm-pts-input"><span class="cm-pts-edit-name">' +
        esc(isStep ? _cmStepLabel(pick.key) : names[pick.level]) +
        '</span> ' +
        (isStep ? 'counts as' : 'starts at') +
        '</label>' +
        '<input class="cm-input cm-pts-input" type="number" id="cm-pts-input" ' +
        (isStep ? 'min="0" max="100" step="0.1"' : 'min="1" max="99" step="1"') +
        ' value="' +
        esc(value) +
        '" data-action-change="cmPointsScale" data-action-input="cmPtsLive"' +
        (state._cmPtsError ? ' aria-invalid="true" aria-describedby="cm-pts-error"' : '') +
        '><span class="cm-pts-unit">%</span>';
    }
    return (
      '<div class="cm-pts-scale">' +
      '<span class="cm-label" id="cm-pts-label">Points and Proficiency</span>' +
      CmGradingBars.renderScaleHint() +
      '<div class="cm-pts-scroll"><div class="cm-pts-ruler' +
      (rows.indexOf(1) >= 0 ? ' is-two-rows' : '') +
      '" id="cm-pts-ruler" role="group" aria-labelledby="cm-pts-label">' +
      markers +
      '<div class="cm-pts-bands" aria-hidden="true">' +
      bands +
      '</div>' +
      edges +
      '<div class="cm-pts-ticks" aria-hidden="true">' +
      ticks +
      '</div>' +
      '</div></div>' +
      '<div class="cm-pts-edit">' +
      edit +
      '</div>' +
      (state._cmPtsError
        ? '<div class="cm-pts-error" id="cm-pts-error" role="alert">' + esc(state._cmPtsError) + '</div>'
        : '') +
      CmGradingBars.renderPresets(scale) +
      '</div>'
    );
  }

  var _cmMatchedPercents = CmGradingBars.matchedPercents;

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

  function _cmSamePercents(a, b) {
    var x = countsAsStepPercents(a);
    var y = countsAsStepPercents(b);
    return x.every(function (v, i) {
      return Math.abs(v - y[i]) < 1e-9;
    });
  }

  /* Saves the scale. A change to Counts As moves the course % of every
     term, so with a term already ended the teacher confirms first. */
  function _cmApplyPointsScale(cid, scale) {
    var before = getGradingScale(cid).percents;
    function save() {
      var cc = getCourseConfig(cid);
      cc.gradingScale = scale;
      saveCourseConfig(cid, cc);
      if (typeof clearProfCache === 'function') clearProfCache();
      renderClassManager();
    }
    var ended = _cmSamePercents(before, scale.percents) ? null : _cmEndedTerm(cid);
    if (!ended) return save();
    renderClassManager();
    showConfirm(
      'Change the Course %?',
      'This changes the course % for every term, including ' +
        (ended.label || 'Term ' + ended.ordinal) +
        ', which has already ended. Report cards printed before today won’t match.',
      'Change',
      'primary',
      save,
    );
  }

  /* Saves one marker's or handle's percent, typed, nudged or dragged, with
     the rules the old boxes had: a whole level always has a value; a + or −
     keeps its own, or is left in between when it is cleared or still shows
     its in-between value; each step counts for more than the one below;
     each proficiency starts higher than the one below it. */
  function _cmPtsSave(cid, pick, raw) {
    var scale = getGradingScale(cid);
    var saved = _cmStepValues(scale);
    var at = _cmStarts(scale);
    var percents = _cmOwnPercents(scale);
    var text = String(raw == null ? '' : raw).trim();
    var v = parseFloat(text);
    state._cmPtsPick = Object.assign({}, pick, { cid: cid });
    function refuse(msg) {
      state._cmPtsError = msg;
      state._cmPtsTyped = text;
      renderClassManager();
    }
    if (pick.kind === 'edge') {
      // Blank or not a number: back to what is saved.
      if (!isFinite(v)) {
        state._cmPtsError = null;
        state._cmPtsTyped = null;
        renderClassManager();
        return;
      }
      at[pick.level] = Math.max(0, Math.min(99, parseInt(text, 10) || 0));
      if (!(at[2] > at[1] && at[3] > at[2] && at[4] > at[3]))
        return refuse('Each proficiency must start higher than the one below it.');
    } else {
      var whole = pick.key.length === 1;
      if (text === '' || !isFinite(v)) {
        if (whole || text !== '') {
          state._cmPtsError = null;
          state._cmPtsTyped = null;
          renderClassManager();
          return;
        }
        delete percents[pick.key];
      } else {
        var r = Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;
        if (!whole && !_cmHasOwnStep(scale, pick.key) && _cmPctText(r) === _cmPctText(saved[pick.key]))
          delete percents[pick.key];
        else percents[pick.key] = r;
      }
      var ladder = countsAsStepPercents(percents);
      if (
        !ladder.every(function (x, i) {
          return i === 0 || x > ladder[i - 1];
        })
      )
        return refuse('Each step must count for more than the one below it.');
    }
    var boundaries = DEFAULT_GRADING_SCALE.boundaries.map(function (db) {
      return { min: db.proficiency === 1 ? 0 : at[db.proficiency], proficiency: db.proficiency };
    });
    state._cmPtsError = null;
    state._cmPtsTyped = null;
    var before = JSON.stringify([_cmStarts(scale), _cmOwnPercents(scale)]);
    if (before === JSON.stringify([at, percents])) return renderClassManager();
    // Labels saved before the scale moved here are kept as they were.
    _cmApplyPointsScale(cid, { boundaries: boundaries, percents: percents, labels: scale.labels || null });
  }

  // The box under the scale changed (typed, then Enter or leaving it).
  function cmSavePointsScale(el) {
    if (!state.cmSelectedCourse) return;
    var pick = _cmPtsPicked(state.cmSelectedCourse);
    if (!pick || !el) return;
    _cmPtsSave(state.cmSelectedCourse, pick, el.value);
  }

  function cmPtsPick(el) {
    if (!state.cmSelectedCourse) return;
    // The click that ends a drag: the drag has picked it already.
    if (Date.now() - state._cmPtsDragEnd < 500) return;
    var p = _cmPtsFromEl(state.cmSelectedCourse, el);
    if (!p) return;
    var was = _cmPtsPicked(state.cmSelectedCourse);
    state._cmPtsPick = _cmPtsSame(was, p) ? null : p;
    state._cmPtsError = null;
    state._cmPtsTyped = null;
    state._cmKeepFocusSel = '#' + _cmPtsPickId(p);
    renderClassManager();
  }

  /* Keys on the scale: Left and Right nudge a marker by 0.1 (Shift: 1) and
     a handle by 1 (Shift: 5) and save; Enter in the box saves; Escape lets
     go and puts the focus back on what was picked. */
  function _cmPtsKeydown(e) {
    var el = e.target;
    var cid = state.cmSelectedCourse;
    if (!cid || !el || !el.closest || !el.closest('.cm-pts-scale')) return false;
    var pick = _cmPtsPicked(cid);
    if (e.key === 'Escape' && pick) {
      e.preventDefault();
      state._cmPtsPick = null;
      state._cmPtsError = null;
      state._cmPtsTyped = null;
      state._cmKeepFocusSel = '#' + _cmPtsPickId(pick);
      renderClassManager();
      return true;
    }
    if (el.id === 'cm-pts-input' && e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      if (!pick) return true;
      state._cmKeepFocusSel = '#cm-pts-input';
      _cmPtsSave(cid, pick, el.value);
      return true;
    }
    var btn = el.closest('[data-action="cmPtsPick"]');
    if (!btn || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.metaKey || e.ctrlKey) return false;
    var p = _cmPtsFromEl(cid, btn);
    if (!p) return false;
    e.preventDefault();
    var by = p.kind === 'edge' ? (e.shiftKey ? 5 : 1) : e.shiftKey ? 1 : 0.1;
    var next = Math.round((_cmPtsValue(cid, p) + (e.key === 'ArrowRight' ? by : -by)) * 10) / 10;
    state._cmKeepFocusSel = '#' + _cmPtsPickId(p);
    _cmPtsSave(cid, p, String(next));
    return true;
  }

  /* While typing or dragging, the marker or handle (and the bands either
     side of a handle) move before anything is saved. */
  function _cmPtsPreview(p, v, fromInput) {
    var ruler = document.getElementById('cm-pts-ruler');
    if (!ruler || !ruler.querySelector || typeof CSS === 'undefined' || !CSS.escape) return;
    if (p.kind === 'step') {
      var m = ruler.querySelector('.cm-pts-marker[data-key="' + CSS.escape(p.key) + '"]');
      if (m) /** @type {any} */ (m).style.left = _cmPtsLeft(v);
    } else {
      var edge = ruler.querySelector('.cm-pts-edge[data-level="' + p.level + '"]');
      if (!edge) return;
      /** @type {any} */ (edge).style.left = _cmPtsLeft(v);
      var handle = edge.querySelector('.cm-pts-handle');
      if (handle) handle.textContent = v + '%';
      var cuts = [0];
      [2, 3, 4].forEach(function (l) {
        var e2 = /** @type {any} */ (ruler).querySelector('.cm-pts-edge[data-level="' + l + '"]');
        cuts.push(e2 ? parseFloat(/** @type {any} */ (e2).style.left) || 0 : 0);
      });
      cuts.push(100);
      [1, 2, 3, 4].forEach(function (l) {
        var band = /** @type {any} */ (ruler).querySelector('.cm-pts-band[data-lv="' + l + '"]');
        if (band) /** @type {any} */ (band).style.width = Math.max(0, cuts[l] - cuts[l - 1]) + '%';
      });
    }
    var inp = document.getElementById('cm-pts-input');
    if (inp && !fromInput && _cmPtsSame(_cmPtsPicked(state.cmSelectedCourse), p))
      /** @type {any} */ (inp).value = String(v);
  }

  function cmPtsLive(el) {
    var p = state.cmSelectedCourse && _cmPtsPicked(state.cmSelectedCourse);
    var v = parseFloat(el.value);
    if (p && isFinite(v)) _cmPtsPreview(p, Math.max(0, Math.min(100, v)), true);
  }

  function _initCmPtsDrag() {
    _addDocListener('pointerdown', function (e) {
      if (e.button !== 0 || !state.cmSelectedCourse) return;
      var btn = e.target.closest && e.target.closest('.cm-pts-ruler [data-action="cmPtsPick"]');
      var ruler = btn && btn.closest('.cm-pts-ruler');
      var p = btn && _cmPtsFromEl(state.cmSelectedCourse, btn);
      if (!p || !ruler) return;
      var range = _cmPtsRange(state.cmSelectedCourse, p);
      state._cmPtsDrag = {
        cid: state.cmSelectedCourse,
        pick: p,
        pointer: e.pointerId,
        rect: ruler.getBoundingClientRect(),
        x0: e.clientX,
        moved: false,
        value: _cmPtsValue(state.cmSelectedCourse, p),
        lo: range[0],
        hi: range[1],
      };
      try {
        btn.setPointerCapture(e.pointerId);
      } catch (err) {
        // No capture: the drag still follows the document's pointer events.
      }
    });
    _addDocListener('pointermove', function (e) {
      var d = state._cmPtsDrag;
      if (!d || e.pointerId !== d.pointer || !d.rect.width) return;
      if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return;
      d.moved = true;
      e.preventDefault();
      var snap = d.pick.kind === 'edge' ? 1 : 0.1;
      var v = Math.round(((e.clientX - d.rect.left) / d.rect.width) * 100 * (1 / snap)) / (1 / snap);
      d.value = Math.max(d.lo, Math.min(d.hi, v));
      _cmPtsPreview(d.pick, d.value);
    });
    function end(e) {
      var d = state._cmPtsDrag;
      if (!d || e.pointerId !== d.pointer) return;
      state._cmPtsDrag = null;
      if (!d.moved) return;
      state._cmPtsDragEnd = Date.now();
      if (e.type === 'pointercancel' || d.cid !== state.cmSelectedCourse) return renderClassManager();
      state._cmKeepFocusSel = '#' + _cmPtsPickId(d.pick);
      _cmPtsSave(d.cid, d.pick, String(d.value));
    }
    _addDocListener('pointerup', end);
    _addDocListener('pointercancel', end);
  }

  function cmMatchPointsScale() {
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var scale = getGradingScale(cid);
    state._cmPtsError = null;
    state._cmPtsTyped = null;
    _cmApplyPointsScale(cid, {
      boundaries: scale.boundaries,
      percents: _cmMatchedPercents(scale.boundaries),
      labels: scale.labels || null,
    });
  }

  // The BC Letter Bands preset: Counts As only; Points to Proficiency stays.
  function cmBcPointsScale() {
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var scale = getGradingScale(cid);
    state._cmPtsError = null;
    state._cmPtsTyped = null;
    _cmApplyPointsScale(cid, {
      boundaries: scale.boundaries,
      percents: Object.assign({}, BC_LETTER_BAND_PERCENTS),
      labels: scale.labels || null,
    });
  }

  function cmResetPointsScale() {
    if (!state.cmSelectedCourse) return;
    state._cmPtsError = null;
    state._cmPtsTyped = null;
    // Saved, not deleted: other devices only take a scale the server has.
    _cmApplyPointsScale(state.cmSelectedCourse, structuredClone(DEFAULT_GRADING_SCALE));
  }

  var _cmRenderWeightBar = CmGradingBars.renderWeightBar;

  /* One student's grade with the settings on the left, from the class's own
     scores: the year so far, as the gradebook shows it, even when Class
     Management opens over a report (Colin, 2026-11-03). */
  function _cmRenderCheckStudent(cid, gs, method) {
    return readAsOfTerm(cid, null, function () {
      return _cmRenderCheckStudentNow(cid, gs, method);
    });
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
      '</span></div>';

    var lm = getLearningMap(cid);
    // With "Count Only the Most Recent N", only those N count, so only
    // those are listed (Most Recent Score already counts one).
    var lastN = method !== 'mostRecent' ? getRecentScoreLimit(cid) : null;
    var rows = (lm.sections || [])
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
    _cmPtsKeydown: _cmPtsKeydown,
    _cmRenderFoldersCountAsOne: _cmRenderFoldersCountAsOne,
    _cmRenderGradingTab: _cmRenderGradingTab,
    _initCmPtsDrag: _initCmPtsDrag,
    cmBcPointsScale: cmBcPointsScale,
    cmCheckStudent: cmCheckStudent,
    cmFolderCountChoice: cmFolderCountChoice,
    cmMatchPointsScale: cmMatchPointsScale,
    cmPtsLive: cmPtsLive,
    cmPtsPick: cmPtsPick,
    cmResetPointsScale: cmResetPointsScale,
    cmRoundPercentSelect: cmRoundPercentSelect,
    cmSavePointsScale: cmSavePointsScale,
  };
})();
