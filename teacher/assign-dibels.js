// @ts-check
/* assign-dibels.js — Assignments: the DIBELS 8 benchmark. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignDibels = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var _CHEVRON_ICON,
    _MODULE_CHEVRON,
    _MODULE_TRASH,
    _NOT_SCORED_ICON,
    _RUBRIC_ICON,
    _WARNING_ICON,
    _cardHas,
    _cardScoringBadges,
    _categoryChipTip,
    _chipTipAttrs,
    _getAssessmentCategoryId,
    _getCategoryName,
    _graderHtml,
    _newQuizBtn,
    _scoreTagObjs,
    pageState,
    render,
    renderAssessForm,
    _cardMoreMenuHtml,
    _drawnReturn,
    _gradeSubmissionsHtml,
    _graderStatusButtons,
    _groupRowStudents,
    _holdsGrades,
    _inlineGraderHtml,
    _returnChipsHtml,
    _returnDraftsButtonHtml;
  function configure(h) {
    if ('_CHEVRON_ICON' in h) _CHEVRON_ICON = h._CHEVRON_ICON;
    if ('_MODULE_CHEVRON' in h) _MODULE_CHEVRON = h._MODULE_CHEVRON;
    if ('_MODULE_TRASH' in h) _MODULE_TRASH = h._MODULE_TRASH;
    if ('_NOT_SCORED_ICON' in h) _NOT_SCORED_ICON = h._NOT_SCORED_ICON;
    if ('_RUBRIC_ICON' in h) _RUBRIC_ICON = h._RUBRIC_ICON;
    if ('_WARNING_ICON' in h) _WARNING_ICON = h._WARNING_ICON;
    if ('_cardHas' in h) _cardHas = h._cardHas;
    if ('_cardScoringBadges' in h) _cardScoringBadges = h._cardScoringBadges;
    if ('_categoryChipTip' in h) _categoryChipTip = h._categoryChipTip;
    if ('_chipTipAttrs' in h) _chipTipAttrs = h._chipTipAttrs;
    if ('_getAssessmentCategoryId' in h) _getAssessmentCategoryId = h._getAssessmentCategoryId;
    if ('_getCategoryName' in h) _getCategoryName = h._getCategoryName;
    if ('_graderHtml' in h) _graderHtml = h._graderHtml;
    if ('_newQuizBtn' in h) _newQuizBtn = h._newQuizBtn;
    if ('_scoreTagObjs' in h) _scoreTagObjs = h._scoreTagObjs;
    if ('pageState' in h) pageState = h.pageState;
    if ('render' in h) render = h.render;
    if ('renderAssessForm' in h) renderAssessForm = h.renderAssessForm;
    if ('_cardMoreMenuHtml' in h) _cardMoreMenuHtml = h._cardMoreMenuHtml;
    if ('_drawnReturn' in h) _drawnReturn = h._drawnReturn;
    if ('_gradeSubmissionsHtml' in h) _gradeSubmissionsHtml = h._gradeSubmissionsHtml;
    if ('_graderStatusButtons' in h) _graderStatusButtons = h._graderStatusButtons;
    if ('_groupRowStudents' in h) _groupRowStudents = h._groupRowStudents;
    if ('_holdsGrades' in h) _holdsGrades = h._holdsGrades;
    if ('_inlineGraderHtml' in h) _inlineGraderHtml = h._inlineGraderHtml;
    if ('_returnChipsHtml' in h) _returnChipsHtml = h._returnChipsHtml;
    if ('_returnDraftsButtonHtml' in h) _returnDraftsButtonHtml = h._returnDraftsButtonHtml;
  }

  /* ── DIBELS 8 benchmark ─────────────────────────────────────
     Raw scores per window: Oral Reading Fluency words correct and errors,
     Maze correct and incorrect. Accuracy, the adjusted Maze score and the
     Grade 8 levels are worked out (shared/constants.js); none of it counts
     toward a grade. One student gets two cards; the class gets one row each
     with the level counts above. Fields save when they lose focus. */
  var _dibelsPeriods = {};
  var _dibelsLoaded = {};
  function _dibelsPeriodOf(a) {
    return _dibelsPeriods[a.id] || dibelsPeriodFor(courseToday(pageState.activeCourse));
  }
  // html-safe: tone and label come from DIBELS_LEVELS for a computed level; text through esc
  function _dibelsChip(level, text) {
    if (!level) return '<span class="dbl-chip is-empty">—</span>';
    return (
      '<span class="dbl-chip ' +
      DIBELS_LEVELS[level].tone +
      '"><span class="dbl-dot" aria-hidden="true"></span>' +
      esc(text || DIBELS_LEVELS[level].label) +
      '</span>'
    );
  }
  // One student's numbers and what they work out to in one window.
  function _dibelsFigures(cid, sid, aid, period) {
    var row = getDibelsScore(cid, sid, aid, period) || {};
    var adjusted = dibelsMazeAdjusted(row.mazeCorrect, row.mazeIncorrect);
    return {
      row: row,
      accuracy: dibelsAccuracy(row.orfWrc, row.orfErrors),
      adjusted: adjusted,
      orfLevel: dibelsLevel('orf', period, row.orfWrc),
      mazeLevel: dibelsLevel('maze', period, adjusted),
    };
  }
  function _fmtDibels(n) {
    return n == null ? '' : String(Math.round(n * 10) / 10);
  }
  function _dibelsPeriodSegHtml(a) {
    var on = _dibelsPeriodOf(a);
    return (
      '<div class="grader-status dbl-period" role="group" aria-label="Benchmark window">' +
      DIBELS_PERIODS.map(function (p) {
        return (
          '<button type="button" class="grader-status-btn' +
          (p === on ? ' is-on is-period' : '') +
          '" aria-pressed="' +
          (p === on) +
          '" data-action="setDibelsPeriod" data-aid="' +
          a.id +
          '" data-period="' +
          p +
          '">' +
          DIBELS_PERIOD_NAMES[p] +
          '</button>'
        );
      }).join('<span class="grader-status-sep" aria-hidden="true"></span>') +
      '</div>'
    );
  }
  function _dibelsCutsText(period) {
    var o = DIBELS_CUTS.orf[period];
    var m = DIBELS_CUTS.maze[period];
    return (
      'Grade 8 ' +
      DIBELS_PERIOD_NAMES[period].toLowerCase() +
      ' cut points. ORF words correct: Above ' +
      o.above +
      ', Core ' +
      o.core +
      ', Strategic ' +
      o.strategic +
      '. Maze adjusted (correct − incorrect ÷ 2): Above ' +
      m.above +
      ', Core ' +
      m.core +
      ', Strategic ' +
      m.strategic +
      '.'
    );
  }
  // html-safe: fixed labels and _dibelsChip for computed levels
  function _dibelsLevelPillsHtml(cid, a, sid) {
    var f = _dibelsFigures(cid, sid, a.id, _dibelsPeriodOf(a));
    return (
      '<span class="dbl-foot-label">ORF</span>' +
      _dibelsChip(f.orfLevel) +
      '<span class="dbl-foot-label">Maze</span>' +
      _dibelsChip(f.mazeLevel)
    );
  }
  function _dibelsInput(sid, aid, field, value, label, big) {
    return (
      '<input type="text" inputmode="numeric" class="dbl-input' +
      (big ? ' is-big' : '') +
      '" value="' +
      (value == null ? '' : esc(value)) +
      '" aria-label="' +
      esc(label) +
      '" data-action-blur="dibelsField" data-sid="' +
      sid +
      '" data-aid="' +
      aid +
      '" data-field="' +
      field +
      '">'
    );
  }
  function _dibelsCardHtml(cid, a, st) {
    var period = _dibelsPeriodOf(a);
    var f = _dibelsFigures(cid, st.id, a.id, period);
    var o = DIBELS_CUTS.orf[period];
    var m = DIBELS_CUTS.maze[period];
    function stat(label, value, out) {
      return (
        '<div class="dbl-stat"><span class="dbl-stat-label">' +
        label +
        '</span><span class="dbl-stat-value" data-out="' +
        out +
        '">' +
        value +
        '</span></div>'
      );
    }
    function field(label, inner) {
      return '<label class="dbl-field"><span class="dbl-stat-label">' + label + '</span>' + inner + '</label>';
    }
    return (
      '<div class="dbl-card-wrap" data-dibels-card="' +
      a.id +
      '">' +
      '<div class="dbl-bar">' +
      _dibelsPeriodSegHtml(a) +
      '<span class="grader-spacer"></span><span class="dbl-no-grade">Doesn’t count toward grades</span></div>' +
      '<section class="grdl-card dbl-card"><div class="grdl-side"><h3 class="grdl-name">Oral Reading Fluency</h3>' +
      '<span class="grdl-text">Words read correctly and errors in the one-minute passage. Grade 8 cut points: Above ' +
      o.above +
      ', Core ' +
      o.core +
      ', Strategic ' +
      o.strategic +
      '.</span></div><div class="dbl-fields">' +
      field('Words Correct', _dibelsInput(st.id, a.id, 'orfWrc', f.row.orfWrc, 'Words correct', true)) +
      field('Errors', _dibelsInput(st.id, a.id, 'orfErrors', f.row.orfErrors, 'Errors', true)) +
      stat('Accuracy', f.accuracy == null ? '—' : f.accuracy + '%', 'accuracy') +
      stat('Level', _dibelsChip(f.orfLevel), 'orfLevel') +
      '</div></section>' +
      '<section class="grdl-card dbl-card"><div class="grdl-side"><h3 class="grdl-name">Maze</h3>' +
      '<span class="grdl-text">Correct and incorrect answers. Adjusted = correct − incorrect ÷ 2. Cut points: Above ' +
      m.above +
      ', Core ' +
      m.core +
      ', Strategic ' +
      m.strategic +
      '.</span></div><div class="dbl-fields">' +
      field('Correct', _dibelsInput(st.id, a.id, 'mazeCorrect', f.row.mazeCorrect, 'Maze correct', true)) +
      field('Incorrect', _dibelsInput(st.id, a.id, 'mazeIncorrect', f.row.mazeIncorrect, 'Maze incorrect', true)) +
      stat('Adjusted', f.adjusted == null ? '—' : _fmtDibels(f.adjusted), 'adjusted') +
      stat('Level', _dibelsChip(f.mazeLevel), 'mazeLevel') +
      '</div></section></div>'
    );
  }
  // html-safe: counts are numbers; row names, cut points and window names are constants; ids are ours
  function _dibelsCountsHtml(cid, a, students, period) {
    var counts = { orf: {}, maze: {} };
    var tested = 0;
    students.forEach(function (st) {
      var status = getAssignmentStatus(cid, st.id, a.id);
      if (status === 'NS' || status === 'EXC') return;
      var f = _dibelsFigures(cid, st.id, a.id, period);
      if (f.orfLevel || f.mazeLevel) tested++;
      if (f.orfLevel) counts.orf[f.orfLevel] = (counts.orf[f.orfLevel] || 0) + 1;
      if (f.mazeLevel) counts.maze[f.mazeLevel] = (counts.maze[f.mazeLevel] || 0) + 1;
    });
    function line(name, key) {
      return (
        '<div class="dbl-count-row"><span class="dbl-count-name">' +
        name +
        '</span>' +
        ['above', 'core', 'strategic', 'intensive']
          .map(function (lv) {
            return '<span class="dbl-count">' + _dibelsChip(lv) + '<b>' + (counts[key][lv] || 0) + '</b></span>';
          })
          .join('') +
        '</div>'
      );
    }
    return (
      '<div class="dbl-summary">' +
      '<div class="dbl-bar">' +
      _dibelsPeriodSegHtml(a) +
      '<span class="dbl-tested"><b>' +
      tested +
      '</b> of ' +
      students.length +
      ' tested</span><span class="grader-spacer"></span><span class="dbl-no-grade">Doesn’t count toward grades</span></div>' +
      line('ORF', 'orf') +
      line('Maze', 'maze') +
      '<span class="dbl-cuts">' +
      _dibelsCutsText(period) +
      '</span></div>'
    );
  }
  function _dibelsRowHtml(cid, a, st, period) {
    var f = _dibelsFigures(cid, st.id, a.id, period);
    var status = getAssignmentStatus(cid, st.id, a.id);
    var name = displayNameWithLast(st);
    return (
      '<div class="score-row dbl-row' +
      (status === 'NS' || status === 'EXC' ? ' has-status' : '') +
      '" data-status-student="' +
      st.id +
      '" data-status-assess="' +
      a.id +
      '">' +
      '<span class="ldg-name">' +
      esc(name) +
      '</span>' +
      _dibelsInput(st.id, a.id, 'orfWrc', f.row.orfWrc, 'Words correct, ' + name) +
      _dibelsInput(st.id, a.id, 'orfErrors', f.row.orfErrors, 'Errors, ' + name) +
      '<span class="dbl-num" data-out="accuracy">' +
      (f.accuracy == null ? '' : f.accuracy + '%') +
      '</span>' +
      '<span data-out="orfLevel">' +
      (f.orfLevel ? _dibelsChip(f.orfLevel) : '') +
      '</span>' +
      '<span class="dbl-divider" aria-hidden="true"></span>' +
      _dibelsInput(st.id, a.id, 'mazeCorrect', f.row.mazeCorrect, 'Maze correct, ' + name) +
      _dibelsInput(st.id, a.id, 'mazeIncorrect', f.row.mazeIncorrect, 'Maze incorrect, ' + name) +
      '<span class="dbl-num" data-out="adjusted">' +
      _fmtDibels(f.adjusted) +
      '</span>' +
      '<span data-out="mazeLevel">' +
      (f.mazeLevel ? _dibelsChip(f.mazeLevel) : '') +
      '</span>' +
      '<div class="ldg-status grader-status" role="group" aria-label="Status">' +
      _graderStatusButtons(a.id, st.id, status, ['EXC', 'NS'])
        .replace(/class="grader-status-btn/g, 'class="grader-status-btn ldg-chip')
        .replace(/data-status=/g, 'data-stop-prop="true" tabindex="-1" data-status=') +
      '</div>' +
      '</div>'
    );
  }
  function _dibelsGridHtml(cid, a, students) {
    var period = _dibelsPeriodOf(a);
    return (
      '<div class="dbl-grid" data-aid="' +
      a.id +
      '">' +
      _dibelsCountsHtml(cid, a, students, period) +
      '<div class="dbl-head dbl-head-groups"><span></span><span class="dbl-group">Oral Reading Fluency</span><span></span><span class="dbl-group">Maze</span><span></span></div>' +
      '<div class="dbl-head"><span>Student</span><span class="is-num">Words Correct</span><span class="is-num">Errors</span><span class="is-num">Accuracy</span><span>ORF Level</span><span></span><span class="is-num">Correct</span><span class="is-num">Incorrect</span><span class="is-num">Adjusted</span><span>Maze Level</span><span class="is-end">Status</span></div>' +
      students
        .map(function (st) {
          return _dibelsRowHtml(cid, a, st, period);
        })
        .join('') +
      '</div>'
    );
  }
  // A field left: save the window's four numbers, then redraw what they
  // work out to without redrawing the inputs, so Tab keeps moving on.
  function _commitDibelsField(el) {
    var cid = pageState.activeCourse;
    var sid = el.dataset.sid;
    var aid = el.dataset.aid;
    var a = getAssessments(cid).find(function (x) {
      return x.id === aid;
    });
    if (!a) return;
    var period = _dibelsPeriodOf(a);
    var values = Object.assign({}, getDibelsScore(cid, sid, aid, period) || {});
    var raw = el.value.trim();
    var n = /** @type {any} */ (raw === '' ? null : Math.floor(Number(raw)));
    values[el.dataset.field] = raw === '' || !isFinite(n) || n < 0 ? null : n;
    el.value = values[el.dataset.field] == null ? '' : values[el.dataset.field];
    Grader.setDibels(cid, sid, aid, period, values);
    var f = _dibelsFigures(cid, sid, aid, period);
    var scope = el.closest('.dbl-row') || el.closest('.dbl-card-wrap');
    if (!scope) return;
    // A grid row leaves an empty figure blank; the card shows a dash.
    var none = scope.classList.contains('dbl-row') ? '' : '—';
    scope.querySelector('[data-out="accuracy"]').textContent = f.accuracy == null ? none : f.accuracy + '%';
    scope.querySelector('[data-out="adjusted"]').textContent = f.adjusted == null ? none : _fmtDibels(f.adjusted);
    scope.querySelector('[data-out="orfLevel"]').innerHTML = f.orfLevel || none ? _dibelsChip(f.orfLevel) : '';
    scope.querySelector('[data-out="mazeLevel"]').innerHTML = f.mazeLevel || none ? _dibelsChip(f.mazeLevel) : '';
    if (scope.classList.contains('dbl-row')) {
      var grid = scope.closest('.dbl-grid');
      var summary = grid && grid.querySelector('.dbl-summary');
      if (summary) {
        // Only the counts: the window buttons stay, so a click that ended
        // this field's edit still lands on them.
        var fresh = document.createElement('div');
        fresh.innerHTML = _dibelsCountsHtml(cid, a, sortStudents(getStudents(cid), 'lastName'), period);
        summary.querySelector('.dbl-tested').replaceWith(fresh.querySelector('.dbl-tested'));
        var rows = summary.querySelectorAll('.dbl-count-row');
        fresh.querySelectorAll('.dbl-count-row').forEach(function (row, i) {
          rows[i].replaceWith(row);
        });
      }
    } else {
      // One student: the footer's levels, in the dialog or the inline head.
      var holder = scope.closest('#grader-overlay, .assess-card');
      var levels = holder && holder.querySelector('.grader-dibels-levels');
      if (levels) levels.innerHTML = _dibelsLevelPillsHtml(cid, a, sid);
    }
    refreshSidebarGrades(sid);
  }
  function setDibelsPeriod(aid, period) {
    if (DIBELS_PERIODS.indexOf(period) < 0) return;
    _dibelsPeriods[aid] = period;
    render();
  }
  // The class's DIBELS scores come from the server once per class.
  function _loadDibelsOnce(cid) {
    if (_dibelsLoaded[cid] || typeof loadDibelsScores !== 'function') return;
    var any = getAssessments(cid).some(isDibelsScored);
    if (!any) return;
    _dibelsLoaded[cid] = true;
    loadDibelsScores(cid).then(function (changed) {
      if (changed && pageState.activeCourse === cid) render();
    });
  }
  /* A plain black-and-white sheet of the class's scores in the shown
     window, printed from a hidden frame. */
  function printDibels(aid) {
    var cid = pageState.activeCourse;
    var a = getAssessments(cid).find(function (x) {
      return x.id === aid;
    });
    if (!a) return;
    var period = _dibelsPeriodOf(a);
    var students = sortStudents(getStudents(cid), 'lastName');
    var rows = students
      .map(function (st) {
        var f = _dibelsFigures(cid, st.id, aid, period);
        var status = getAssignmentStatus(cid, st.id, aid);
        var r = f.row;
        function v(x) {
          return x == null ? '' : esc(String(x));
        }
        return (
          '<tr><th>' +
          esc(displayNameWithLast(st)) +
          '</th><td>' +
          v(r.orfWrc) +
          '</td><td>' +
          v(r.orfErrors) +
          '</td><td>' +
          (f.accuracy == null ? '' : f.accuracy + '%') +
          '</td><td>' +
          (f.orfLevel ? DIBELS_LEVELS[f.orfLevel].label : '') +
          '</td><td>' +
          v(r.mazeCorrect) +
          '</td><td>' +
          v(r.mazeIncorrect) +
          '</td><td>' +
          _fmtDibels(f.adjusted) +
          '</td><td>' +
          (f.mazeLevel ? DIBELS_LEVELS[f.mazeLevel].label : '') +
          '</td><td>' +
          (status === 'NS' ? 'Missing' : status === 'EXC' ? 'Excused' : '') +
          '</td></tr>'
        );
      })
      .join('');
    var course = COURSES[cid] || {};
    // The saved PDF's name: "DIBELS 8 Benchmark – Science 8 Block B – Beginning of Year".
    var fileName = printFileName([
      a.title || 'DIBELS 8 Benchmark',
      printClassName(course),
      DIBELS_PERIOD_NAMES[period],
    ]);
    var html =
      '<!doctype html><html><head><meta charset="utf-8"><title>' +
      esc(fileName) +
      '</title><style>' +
      'body{font-family:-apple-system,system-ui,sans-serif;color:#000;margin:0.4in;font-size:10pt}' +
      'h1{font-size:15pt;margin:0 0 2pt}p{margin:0 0 8pt}' +
      'table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:3pt 5pt;text-align:right}' +
      'th{text-align:left;font-weight:700}thead th{text-align:center;background:#eee}' +
      '.cuts{font-size:8.5pt;margin-top:8pt}' +
      '</style></head><body><h1>' +
      esc(a.title || 'DIBELS 8 Benchmark') +
      '</h1><p>' +
      esc([course.name, DIBELS_PERIOD_NAMES[period], a.date ? formatDate(a.date) : ''].filter(Boolean).join(' · ')) +
      '</p><table><thead><tr><th rowspan="2">Student</th><th colspan="4">Oral Reading Fluency</th><th colspan="4">Maze</th><th rowspan="2">Status</th></tr>' +
      '<tr><th>Words Correct</th><th>Errors</th><th>Accuracy</th><th>Level</th><th>Correct</th><th>Incorrect</th><th>Adjusted</th><th>Level</th></tr></thead><tbody>' +
      rows +
      '</tbody></table><p class="cuts">' +
      esc(_dibelsCutsText(period)) +
      ' DIBELS scores count toward no grade.</p></body></html>';
    var frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);
    /** @type {any} */ (frame.contentDocument).open();
    /** @type {any} */ (frame.contentDocument).write(html);
    /** @type {any} */ (frame.contentDocument).close();
    setTimeout(function () {
      // The frame's title names the file; the page's too, for a browser that names it from the page.
      var restoreTitle = setPrintTitle([fileName]);
      /** @type {any} */ (frame.contentWindow).focus();
      /** @type {any} */ (frame.contentWindow).print();
      setTimeout(function () {
        restoreTitle();
        frame.remove();
      }, 1000);
    }, 50);
  }

  /* ── Levels, points and Complete/Incomplete for one student ── */
  // On rubric work a competency is scored through the criteria that feed
  // it: it shows their level (one level, or the lowest marked mixed, with
  // no ±), and a level set on it goes to each of them. Any other key is
  // scored on its own.
  function _tagCriteria(cid, aid, tagId) {
    var a = getAssessments(cid).find(function (x) {
      return x.id === aid;
    });
    return a ? rubricCriteriaForTag(cid, a, tagId) : [];
  }
  // A whole-rubric competency has no keys of its own: its criteria are
  // scored one by one.
  function _tagScoreKeys(cid, aid, tagId) {
    var a = getAssessments(cid).find(function (x) {
      return x.id === aid;
    });
    return a ? rubricRowScoreKeys(cid, a, tagId) : [tagId];
  }
  function _setTagScore(cid, sid, aid, tagId, value, mod) {
    _tagScoreKeys(cid, aid, tagId).forEach(function (key) {
      Grader.setLevel(cid, sid, aid, key, value, mod);
    });
  }
  function _tagState(cid, sid, aid, tagId) {
    var crits = _tagCriteria(cid, aid, tagId);
    if (crits.length) {
      var a = getAssessments(cid).find(function (x) {
        return x.id === aid;
      });
      var lv = competencyLevelFromCriteria(cid, sid, a, tagId, crits);
      if (!lv) return { level: 0, mod: 0, mixed: false };
      return { level: lv.score, mod: lv.mixed ? 0 : lv.mod, mixed: lv.mixed };
    }
    var e = (getScores(cid)[sid] || []).find(function (x) {
      return x.assessmentId === aid && x.tagId === tagId;
    });
    var v = e ? Number(e.score) || 0 : 0;
    return { level: v, mod: v && e.mod ? e.mod : 0, mixed: false };
  }
  function _graderStepperHtml(level, mod, attrs) {
    var name = PROF_LABELS[level] || '';
    var off = !level;
    return (
      '<span class="grdl-stepper" role="group" aria-label="Fine-tune' +
      (name ? ' ' + name : '') +
      '">' +
      '<button type="button" ' +
      attrs +
      ' data-mod="-1" aria-label="Low ' +
      name +
      '" aria-pressed="' +
      (mod < 0) +
      '"' +
      (off || normalizeScoreMod(level, -1) !== -1 ? ' disabled' : '') +
      (mod < 0 ? ' class="is-on"' : '') +
      '>−</button><span class="grdl-stepper-sep" aria-hidden="true"></span>' +
      '<button type="button" ' +
      attrs +
      ' data-mod="1" aria-label="High ' +
      name +
      '" aria-pressed="' +
      (mod > 0) +
      '"' +
      (off || normalizeScoreMod(level, 1) !== 1 ? ' disabled' : '') +
      (mod > 0 ? ' class="is-on"' : '') +
      '>+</button></span>'
    );
  }
  // The chosen level holds its − | +, as a chosen rubric tile does, so the
  // fine-tune sits on the level it changes and picking moves nothing else.
  function _graderPickHtml(levelBtn, colour, level, mod, attrs, mixed) {
    return (
      '<span class="grdl-pick l' +
      colour +
      (mixed ? ' mixed' : '') +
      '">' +
      levelBtn +
      _graderStepperHtml(level, mod, attrs) +
      '</span>'
    );
  }
  function _levelCardsHtml(cid, a, tagObjs, st) {
    var order = levelOrderFor(cid);
    // Feedback per competency lives on tag_score, which rubric work doesn't use.
    var withNotes = !a.rubricId;
    return (
      '<div class="grdl-cards">' +
      tagObjs
        .map(function (t) {
          var state = _tagState(cid, st.id, a.id, t.id);
          var tag = t.tag || null;
          var code = tag ? tag.code || (tag.id && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(tag.id) ? tag.id : '') : '';
          var seg = order
            .map(function (lv) {
              var on = state.level === lv;
              var btn =
                '<button type="button" class="grdl-level' +
                (on ? ' is-on l' + lv + (state.mixed ? ' mixed' : '') : '') +
                '" data-action="graderTagLevel" data-tag="' +
                esc(t.id) +
                '" data-level="' +
                lv +
                '" aria-pressed="' +
                on +
                '">' +
                PROF_LABELS[lv] +
                '</button>';
              return on
                ? _graderPickHtml(
                    btn,
                    lv,
                    state.mixed ? 0 : state.level,
                    state.mod,
                    'data-action="graderTagMod" data-tag="' + esc(t.id) + '"',
                    state.mixed,
                  )
                : btn;
            })
            .join('');
          return (
            '<section class="grdl-card" tabindex="0" data-tag="' +
            esc(t.id) +
            '" aria-label="' +
            esc(t.label || '') +
            '">' +
            '<div class="grdl-side"><div class="grdl-name-row"><h3 class="grdl-name">' +
            esc(t.label || '') +
            '</h3>' +
            (code ? '<span class="grdt-code">' + esc(code) + '</span>' : '') +
            '</div>' +
            (t.text && t.text !== t.label ? '<span class="grdl-text">' + esc(t.text) + '</span>' : '') +
            (state.level ? '' : '<span class="grdt-not-scored">' + _NOT_SCORED_ICON + 'Not Scored</span>') +
            '</div>' +
            '<div class="grdl-controls"><div class="grdl-seg" role="group" aria-label="Level">' +
            seg +
            '</div>' +
            '</div>' +
            (withNotes ? _tagNoteHtml(cid, a.id, st.id, t.id) : '') +
            '</section>'
          );
        })
        .join('') +
      '</div>'
    );
  }
  // The competency's Comment (Optional) box, one line until it has focus
  // or text, as under a rubric criterion.
  function _tagNoteHtml(cid, aid, sid, tagId) {
    var note = getTagComment(cid, sid, aid, tagId);
    var id = 'grdl-note-' + esc(aid) + '-' + esc(tagId);
    return (
      '<label class="grdt-note-label grdl-note-label" for="' +
      id +
      '">Comment (Optional)</label>' +
      '<textarea id="' +
      id +
      '" class="grdt-note' +
      (note ? ' has-text' : '') +
      '" rows="1" data-action-blur="graderTagNote" data-tag="' +
      esc(tagId) +
      '">' +
      esc(note) +
      '</textarea>'
    );
  }
  function _pointsCardHtml(cid, a, st) {
    var max = Number(a.maxPoints) || 100;
    var raw = getPointsScore(cid, st.id, a.id);
    var status = getAssignmentStatus(cid, st.id, a.id);
    var locked = status === 'NS' || status === 'EXC';
    return (
      '<section class="grdp-card">' +
      '<div class="grdl-side"><label class="grdl-name" for="grdp-input-' +
      esc(a.id) +
      '">Score</label>' +
      '<span class="grdl-text">Type the points earned. Up to twice the total counts as extra credit.</span></div>' +
      '<div class="grdp-entry"><input id="grdp-input-' +
      esc(a.id) +
      '" class="grdp-input" type="text" inputmode="decimal" autocomplete="off"' +
      ' data-action-blur="graderPoints" data-max="' +
      max +
      '" value="' +
      (raw != null ? esc(formatPoints(raw)) : '') +
      '"' +
      (locked ? ' disabled' : '') +
      '><span class="grdp-max">/ ' +
      esc(formatPoints(max)) +
      '</span>' +
      (raw != null ? '<span class="grdp-pct">' + formatPointsPercent(raw, max) + '</span>' : '') +
      '</div></section>'
    );
  }
  function _completeCardHtml(cid, a, st) {
    var mark = getCompletionMark(cid, st.id, a.id);
    var status = getAssignmentStatus(cid, st.id, a.id);
    var locked = status === 'NS' || status === 'EXC';
    function btn(value, label, icon) {
      var on = mark === value;
      return (
        '<button type="button" class="grdc-btn grdc-' +
        value +
        (on ? ' is-on' : '') +
        '" data-action="graderMark" data-mark="' +
        value +
        '" aria-pressed="' +
        on +
        '"' +
        (locked ? ' disabled' : '') +
        '>' +
        icon +
        label +
        '</button>'
      );
    }
    return (
      '<section class="grdp-card">' +
      '<div class="grdl-side"><h3 class="grdl-name">Mark</h3><span class="grdl-text">Click again to clear the mark.</span></div>' +
      '<div class="grdc-pair" role="group" aria-label="Mark">' +
      btn(
        'complete',
        'Complete',
        '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" class="grdc-icon-bg"/><path d="M7.5 12.5l3 3 6-6.5" fill="none" class="grdc-icon-mark" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      ) +
      btn(
        'incomplete',
        'Incomplete',
        '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" class="grdc-icon-bg"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" fill="none" class="grdc-icon-mark" stroke-width="2.4" stroke-linecap="round"/></svg>',
      ) +
      '</div></section>'
    );
  }

  // Whether a card is drawn open: one student's view opens every card but
  // the ones closed (Expand), or the ones opened.
  function _cardOpen(aid) {
    return pageState.focusStudentId && pageState._allExpanded
      ? !pageState._collapsedIds.has(aid)
      : pageState.openAssessIds.has(aid);
  }

  // An open card's body: its description and its grading controls.
  // html-safe: the description goes through esc; the grading builders are reviewed
  function _cardBodyHtml(cid, a, focusSt, students, scores) {
    students = AssignShow.students(cid, a, students);
    var tagObjs = _scoreTagObjs(cid, a);
    return (
      (a.description
        ? '<div style="font-size:0.9375rem;color:var(--text-2);margin:8px 0 12px;line-height:1.5;padding:10px 14px;background:var(--bg);border-radius:var(--radius-sm)">' +
          esc(a.description) +
          '</div>'
        : '') +
      (focusSt
        ? _inlineGraderHtml(cid, a, tagObjs, focusSt, scores)
        : _graderHtml(cid, a, tagObjs, pageState.focusStudentId ? [] : _groupRowStudents(cid, a, students), scores))
    );
  }

  /* The counts in a card's header that grading in place leaves as they
     were drawn: Missing, To Grade and Grade Submissions. Opening or closing
     a card brings them up to date (_refreshCardCounts), as the whole
     redraw it replaced did. */
  // html-safe: numbers, fixed words and icons; the builders are reviewed
  function _cardCounts(cid, a, students, shownIds, tograde) {
    // Students whose work is labelled Missing, whatever the due date.
    var missingCount = students.filter(function (st) {
      return getAssignmentStatus(cid, st.id, a.id) === 'NS';
    }).length;
    var meta =
      (missingCount
        ? '<span class="assess-missing" title="' +
          missingCount +
          (missingCount === 1 ? ' student' : ' students') +
          ' labelled Missing">' +
          _WARNING_ICON +
          missingCount +
          ' missing</span>'
        : '') + AssignShow.toGradeChipHtml(cid, a, shownIds, tograde);
    var out = { meta: meta, button: _gradeSubmissionsHtml(cid, a, shownIds, tograde) };
    _drawnReturn('n' + a.id, meta + '|' + out.button);
    return out;
  }
  // One word of a card's data-has, in the order a redraw writes them.
  function _setHas(card, word, on) {
    var has = (card.dataset.has || '').split(' ');
    var words = ['submitted', 'tograde', 'toreturn', 'notin']
      .filter(function (w) {
        return w === word ? on : has.indexOf(w) >= 0;
      })
      .join(' ');
    if (words) card.dataset.has = words;
    else card.removeAttribute('data-has');
  }
  function _refreshCardCounts(cid, byId, students, shownIds) {
    var classOn = GraderWork.workOnInClass(cid);
    var total = 0;
    document.querySelectorAll('#main .assess-card').forEach(function (card) {
      var a = byId[card.id.slice(3)];
      var head = /** @type {any} */ (card.querySelector('.assess-header'));
      if (!a || !head) return;
      var wc = classOn ? GraderWork.workCounts(cid, a.id, shownIds) : null;
      var tograde = wc ? wc.tograde : undefined;
      total += tograde || 0;
      if (wc) {
        _setHas(card, 'tograde', wc.tograde > 0);
        _setHas(card, 'notin', wc.notin > 0);
      }
      var c = _cardCounts(cid, a, students, shownIds, tograde);
      if (head._countsHtml === c.meta + '|' + c.button) return;
      head._countsHtml = c.meta + '|' + c.button;
      head.querySelectorAll('.assess-missing, .assess-to-grade, .assess-grade-work-btn').forEach(function (el) {
        el.remove();
      });
      // html-safe: built by _cardCounts
      head.querySelector('.assess-date').insertAdjacentHTML('afterend', c.meta);
      // html-safe: built by _gradeSubmissionsHtml
      head.querySelector('.assess-header-actions').insertAdjacentHTML('afterbegin', c.button);
    });
    if (classOn) AssignShow.toGradeTotal(total);
  }

  // The new or edit form's place, above the cards or the List.
  // html-safe: the form escapes its own text
  function _newFormHtml(cid) {
    return (
      '<div id="new-assess-form" data-cid="' +
      esc(cid) +
      '" style="display:' +
      (pageState._showingNewForm ? 'block' : 'none') +
      ';background:var(--bg);border:2px solid var(--active);border-radius:var(--radius);padding:16px;margin-bottom:16px;box-shadow:0 4px 20px rgba(0,122,255,0.12)">' +
      // An open form kept through this redraw is put back by render().
      (pageState._showingNewForm && !pageState._keepingForm
        ? renderAssessForm(
            cid,
            pageState._editingAssessId
              ? getAssessments(cid).find(function (a) {
                  return a.id === pageState._editingAssessId;
                })
              : null,
          )
        : '') +
      '</div>'
    );
  }

  // html-safe: titles, descriptions, category/rubric/module names through esc; colours through cssColor or fixed palettes; grading builders reviewed
  function renderAssessmentList(cid, assessments, allAssessments, students, scores, modules, nums, shownIds) {
    var html =
      '<div class="settings-grid" style="display:grid;grid-template-columns:1fr;gap:20px;align-items:start;padding:12px 12px 20px">';
    html += '<div>';

    html += _newFormHtml(cid);

    // Assessment cards grouped by module folders
    var focusSt = pageState.focusStudentId
      ? students.find(function (st) {
          return st.id === pageState.focusStudentId;
        })
      : null;
    // What is waiting to return (S1-F2), in a class that holds grades.
    var holds = _holdsGrades(cid);
    function renderAssessCard(a, isUncategorized) {
      var isOpen = _cardOpen(a.id);
      var n = nums[a.id] || {};
      var counts = _cardCounts(cid, a, students, shownIds, n.tograde);
      var categoryId = _getAssessmentCategoryId(a);
      var categoryName = _getCategoryName(cid, categoryId);
      var c =
        '<div class="assess-card' +
        (isOpen ? ' open active' : '') +
        (a.isDraft ? ' is-draft' : '') +
        '" id="ac-' +
        a.id +
        '"' +
        _cardHas(n) +
        ' draggable="true"' +
        ' data-assess-drag="' +
        a.id +
        '"' +
        ' data-assess-card-drop="' +
        a.id +
        '"' +
        '>' +
        '<div class="assess-header" data-action="toggleAssess" data-aid="' +
        a.id +
        '">' +
        '<span class="assess-grip" aria-hidden="true" title="Drag to reorder">⠿</span>' +
        '<div class="assess-header-info">' +
        '<span class="assess-title">' +
        esc(a.title) +
        '</span>' +
        '<span class="assess-meta">' +
        (function () {
          if (assessmentNeedsCategory(cid, a))
            return (
              '<span class="type-badge type-badge-needs"' +
              _chipTipAttrs(NEEDS_CATEGORY_LABEL, NEEDS_CATEGORY_TIP) +
              '>' +
              esc(NEEDS_CATEGORY_LABEL) +
              '</span>'
            );
          var idx = categoryId
            ? (getCategories(cid) || []).findIndex(function (c) {
                return c.id === categoryId;
              })
            : -1;
          var t =
            typeof categoryTintByIndex === 'function' ? categoryTintByIndex(idx, categoryName) : { bg: '', fg: '' };
          // With a category, the pill is a button: it filters the list to it.
          return (
            '<' +
            (categoryId
              ? 'button type="button" data-action="toggleCategoryFilter" data-catid="' +
                esc(categoryId) +
                '" aria-pressed="' +
                (pageState.filterCategories.indexOf(categoryId) >= 0) +
                '"'
              : 'span') +
            ' class="type-badge ' +
            (categoryId ? 'type-badge-s' : 'type-badge-f') +
            '"' +
            _chipTipAttrs(categoryName, _categoryChipTip(cid, categoryId)) +
            ' style="background:' +
            t.bg +
            ';color:' +
            t.fg +
            '">' +
            esc(categoryName) +
            '</' +
            (categoryId ? 'button' : 'span') +
            '>'
          );
        })() +
        (a.rubricId
          ? (function () {
              var r = getRubricById(cid, a.rubricId);
              return r
                ? '<span class="rubric-badge"' +
                    _chipTipAttrs(r.name, 'The rubric used to grade this work.') +
                    '>' +
                    _RUBRIC_ICON +
                    esc(r.name) +
                    '</span>'
                : '';
            })()
          : '') +
        _cardScoringBadges(a) +
        // A quiz's results (teacher/quiz-results.js): '' with the quizzes switch off.
        (window.QuizResults ? QuizResults.cardLine(cid, a) : '') +
        (a.coreCompetencyIds || [])
          .map(function (ccId) {
            var cc = getCoreCompetency(ccId);
            return cc
              ? '<span class="cc-badge"' +
                  _chipTipAttrs(cc.label, 'Core Competency') +
                  ' style="border-color:' +
                  cc.color +
                  ';color:' +
                  tintText(cc.color) +
                  '">' +
                  esc(cc.id) +
                  '</span>'
              : '';
          })
          .join('') +
        (a.collaboration && a.collaboration !== 'individual'
          ? '<span class="collab-badge">' + esc(a.collaboration[0].toUpperCase() + a.collaboration.slice(1)) + '</span>'
          : '') +
        (window.AssessmentCopy ? AssessmentCopy.renderCardCopies(cid, a) : '') +
        AssignDraft.chipHtml(cid, a) +
        '<span class="assess-date">' +
        // Assigned \u2192 due. `date` is the assigned date (date_assigned on the
        // server); the due date is its own field.
        formatDate(a.dateAssigned || a.date) +
        (a.dueDate ? ' \u2192 ' + formatDate(a.dueDate) : '') +
        '</span>' +
        counts.meta +
        (holds && !isDibelsScored(a)
          ? '<span class="assess-returns" data-returns-aid="' +
            a.id +
            '">' +
            _drawnReturn('c' + a.id, _returnChipsHtml(cid, a, shownIds, _drawnReturn('d' + a.id, n.drafts))) +
            '</span>'
          : '') +
        '</span>' +
        '</div>' +
        '<div class="assess-header-actions" data-stop-prop="true">' +
        counts.button +
        (holds && !isDibelsScored(a)
          ? '<span class="assess-return-slot" data-return-slot-aid="' +
            a.id +
            '">' +
            _drawnReturn('s' + a.id, _returnDraftsButtonHtml(cid, a, shownIds)) +
            '</span>'
          : '') +
        AssignDraft.assignButtonHtml(cid, a) +
        _cardMoreMenuHtml(cid, a) +
        '</div>' +
        '<span class="assess-chevron" aria-hidden="true">' +
        _CHEVRON_ICON +
        '</span>' +
        '</div>' +
        // A closed card has no body: its grid is built when it opens. (Every
        // card's whole-class grid used to be built and kept out of sight:
        // 80,000 elements on a class of 30 with 36 pieces.)
        '<div class="assess-body">' +
        (isOpen ? (a.isDraft ? AssignDraft.bodyHtml(cid, a) : _cardBodyHtml(cid, a, focusSt, students, scores)) : '') +
        '</div>' +
        '</div>';
      return c;
    }

    // Group assessments by module
    var grouped = {};
    modules.forEach(function (u) {
      grouped[u.id] = [];
    });
    grouped['__none__'] = [];
    assessments.forEach(function (a) {
      var key = a.moduleId && grouped[a.moduleId] ? a.moduleId : '__none__';
      grouped[key].push(a);
    });

    // A search or filter opens every module with matches; the Show bar only
    // lists, and leaves folders and cards as the teacher has them.
    var opensFolders =
      pageState.filterCategories.length > 0 ||
      pageState.showUngraded ||
      !!pageState.assessSearch ||
      pageState._toReturnOnly;
    var filtersActive = opensFolders || AssignShow.on();
    if (!opensFolders) pageState._filterClosedModules = {};

    // Nothing to show: say so first, above any modules.
    if (assessments.length === 0 && allAssessments.length > 0) {
      html +=
        '<div class="assess-list-empty" style="text-align:center;color:var(--text-3);padding:40px 0">' +
        '<div style="font-size:0.9375rem;margin-bottom:4px">No matching assessments.</div>' +
        '<div style="font-size:0.8125rem">Try adjusting your filters or <button type="button" data-action="clearAssessFilters" style="font:inherit;color:var(--link);text-decoration:underline;background:none;border:0;padding:0;cursor:pointer">clear all filters</button>.</div>' +
        '</div>';
    } else if (allAssessments.length === 0) {
      html +=
        '<div class="empty-state assess-list-empty">' +
        '<div class="empty-state-title">No assessments yet</div>' +
        '<div class="empty-state-text">Create your first assessment to start grading.</div>' +
        '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:16px">' +
        _newQuizBtn(cid) +
        '<button class="tb-action-btn" data-action="showNewForm">+ New Assessment</button>' +
        '</div>' +
        '</div>';
    }

    // Render module folders with drop zones
    modules.forEach(function (u, idx) {
      var items = grouped[u.id];
      if (filtersActive && items.length === 0) return;
      var isOpen = !pageState.collapsedModules[u.id];
      var containsOpen =
        pageState.openAssessIds.size > 0 &&
        items.some(function (a) {
          return pageState.openAssessIds.has(a.id);
        });
      // Searching or filtering shows every module with matches open.
      var folderOpen = opensFolders ? !pageState._filterClosedModules[u.id] : isOpen || containsOpen;
      html += '<div class="mod-drop-zone" data-drop-index="' + idx + '" data-mod-drop-zone="true"></div>';
      html +=
        '<div class="mod-folder' +
        (folderOpen ? ' open' : '') +
        '" style="--mod-color:' +
        cssColor(u.color || '#6366f1') +
        '" data-module-id="' +
        u.id +
        '" draggable="true" data-module-drag="' +
        u.id +
        '" data-folder-drop="' +
        u.id +
        '">' +
        '<div class="mod-folder-header" data-action="toggleModuleFolder" data-uid="' +
        u.id +
        '">' +
        '<span class="mod-folder-grip" aria-hidden="true" title="Drag to reorder">\u2807</span>' +
        '<span class="mod-folder-chevron" aria-hidden="true">' +
        _MODULE_CHEVRON +
        '</span>' +
        '<button type="button" class="mod-folder-color" style="background:' +
        cssColor(u.color || '#6366f1') +
        '" title="Change colour" aria-label="Change colour" aria-haspopup="dialog" draggable="false"' +
        ' data-action="openModuleColorPop" data-moduleid="' +
        u.id +
        '" data-stop-prop="true"></button>' +
        '<input class="mod-folder-name-input" value="' +
        esc(u.name) +
        '" size="' +
        Math.max(4, (u.name || '').length) +
        '" title="' +
        esc(u.name) +
        '" aria-label="Module name" spellcheck="false" autocomplete="off" draggable="false"' +
        ' data-stop-prop="true" data-action-blur="moduleName" data-moduleid="' +
        u.id +
        '">' +
        '<span class="mod-folder-meta">' +
        items.length +
        ' Assignment' +
        (items.length !== 1 ? 's' : '') +
        '</span>' +
        '<div class="mod-folder-actions" data-stop-prop="true">' +
        '<button class="mod-folder-action delete" data-action="deleteModule" data-uid="' +
        u.id +
        '" data-count="' +
        items.length +
        '" title="Delete module" aria-label="Delete module">' +
        _MODULE_TRASH +
        '</button>' +
        '</div>' +
        '</div>' +
        '<div class="mod-folder-body">' +
        (items.length > 0
          ? items
              .map(function (a) {
                return renderAssessCard(a);
              })
              .join('')
          : '<div class="mod-folder-empty">Drop assignments here or create a new one</div>') +
        '</div>' +
        '</div>';
    });
    if (modules.length > 0) {
      html += '<div class="mod-drop-zone" data-drop-index="' + modules.length + '" data-mod-drop-zone="true"></div>';
    }

    // Ungrouped assessments
    var ungrouped = grouped['__none__'];
    if (modules.length === 0) {
      ungrouped.forEach(function (a) {
        html += renderAssessCard(a, true);
      });
    } else if (filtersActive && ungrouped.length === 0) {
      // hide
    } else {
      var noModOpen = !pageState.collapsedModules['__none__'];
      var containsOpenNoMod =
        pageState.openAssessIds.size > 0 &&
        ungrouped.some(function (a) {
          return pageState.openAssessIds.has(a.id);
        });
      var folderOpen = opensFolders
        ? !pageState._filterClosedModules['__none__']
        : (ungrouped.length > 0 && noModOpen) || containsOpenNoMod;
      html +=
        '<div class="mod-folder no-module' +
        (folderOpen ? ' open' : '') +
        (ungrouped.length === 0 ? ' empty-target' : '') +
        '" data-module-id="__none__" data-folder-drop="__none__">' +
        '<div class="mod-folder-header" data-action="toggleModuleFolder" data-uid="__none__">' +
        '<span class="mod-folder-chevron" aria-hidden="true">' +
        _MODULE_CHEVRON +
        '</span>' +
        '<span class="mod-folder-name">Ungrouped Assignments</span>' +
        '<span class="mod-folder-meta">' +
        ungrouped.length +
        ' Assignment' +
        (ungrouped.length !== 1 ? 's' : '') +
        '</span>' +
        '</div>' +
        '<div class="mod-folder-body">' +
        (ungrouped.length > 0
          ? ungrouped
              .map(function (a) {
                return renderAssessCard(a, true);
              })
              .join('')
          : '<div class="mod-folder-empty">Drop an assignment here to take it out of its module</div>') +
        '</div>' +
        '</div>';
    }

    if (!filtersActive) html += '<button class="add-module-btn" data-action="addModuleInline">+ Add Module</button>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  return {
    configure: configure,
    _cardBodyHtml: _cardBodyHtml,
    _cardOpen: _cardOpen,
    _commitDibelsField: _commitDibelsField,
    _completeCardHtml: _completeCardHtml,
    _dibelsCardHtml: _dibelsCardHtml,
    _dibelsGridHtml: _dibelsGridHtml,
    _dibelsLevelPillsHtml: _dibelsLevelPillsHtml,
    _graderPickHtml: _graderPickHtml,
    _levelCardsHtml: _levelCardsHtml,
    _loadDibelsOnce: _loadDibelsOnce,
    _newFormHtml: _newFormHtml,
    _pointsCardHtml: _pointsCardHtml,
    _refreshCardCounts: _refreshCardCounts,
    _setHas: _setHas,
    _setTagScore: _setTagScore,
    _tagScoreKeys: _tagScoreKeys,
    _tagState: _tagState,
    printDibels: printDibels,
    renderAssessmentList: renderAssessmentList,
    setDibelsPeriod: setDibelsPeriod,
  };
})();
