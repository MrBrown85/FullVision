// @ts-check
/* assign-ledger.js — Assignments: Complete/Incomplete and points rows. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignLedger = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var _groupRows,
    pageState,
    render,
    _assignmentCommentCount,
    _groupRowFor,
    _ledgerMembersHtml,
    _ledgerStatusOrNoteHtml,
    _overallCommentFieldHtml,
    _returnMarkHtml,
    _showFillUndo,
    _statusLockAttrs,
    _workIconHtml,
    syncModRow;
  function configure(h) {
    if ('_groupRows' in h) _groupRows = h._groupRows;
    if ('pageState' in h) pageState = h.pageState;
    if ('render' in h) render = h.render;
    if ('_assignmentCommentCount' in h) _assignmentCommentCount = h._assignmentCommentCount;
    if ('_groupRowFor' in h) _groupRowFor = h._groupRowFor;
    if ('_ledgerMembersHtml' in h) _ledgerMembersHtml = h._ledgerMembersHtml;
    if ('_ledgerStatusOrNoteHtml' in h) _ledgerStatusOrNoteHtml = h._ledgerStatusOrNoteHtml;
    if ('_overallCommentFieldHtml' in h) _overallCommentFieldHtml = h._overallCommentFieldHtml;
    if ('_returnMarkHtml' in h) _returnMarkHtml = h._returnMarkHtml;
    if ('_showFillUndo' in h) _showFillUndo = h._showFillUndo;
    if ('_statusLockAttrs' in h) _statusLockAttrs = h._statusLockAttrs;
    if ('_workIconHtml' in h) _workIconHtml = h._workIconHtml;
    if ('syncModRow' in h) syncModRow = h.syncModRow;
  }

  /* ── Scoring Functions ──────────────────────────────────── */
  // html-safe: marks and labels are constants; aid and sid are our ids
  function completionButtonsHtml(aid, sid, mark) {
    return (
      '<span class="ldg-seg" role="group" aria-label="Mark">' +
      ['complete', 'incomplete']
        .map(function (m) {
          return (
            '<button type="button" class="cmp-btn cmp-' +
            m +
            (mark === m ? ' active' : '') +
            '" aria-pressed="' +
            (mark === m) +
            '" tabindex="-1" data-action="setCompletion" data-mark="' +
            m +
            '" data-aid="' +
            aid +
            '" data-sid="' +
            sid +
            '">' +
            (m === 'complete' ? _CMP_ICON_COMPLETE + 'Complete' : _CMP_ICON_INCOMPLETE + 'Incomplete') +
            '</button>'
          );
        })
        .join('') +
      '</span>'
    );
  }

  // A filled circle in the mark's colour; white on the chosen capsule.
  var _CMP_ICON_COMPLETE =
    '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" class="cmp-icon-bg"/><path d="M7.5 12.5l3 3 6-6.5" fill="none" class="cmp-icon-mark" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var _CMP_ICON_INCOMPLETE =
    '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" class="cmp-icon-bg"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" fill="none" class="cmp-icon-mark" stroke-width="2.4" stroke-linecap="round"/></svg>';

  /* ── Ledger rows (Complete/Incomplete and points) ───────────
     One line per student: Name · Mark · Status · Comment. The rubric and
     proficiency grids keep their own layout (renderStatusToggles). */
  var LEDGER_STATUSES = [
    ['NS', 'Missing', 'active-ns'],
    ['EXC', 'Excused', 'active-excused'],
    ['LATE', 'Late', 'active-late'],
  ];

  // Missing | Excused | Late as one segmented control, like the grader's.
  function ledgerStatusHtml(aid, sid, current) {
    return (
      '<div class="ldg-status grader-status" role="group" aria-label="Status">' +
      LEDGER_STATUSES.map(function (s) {
        var on = current === s[0];
        return (
          '<button type="button" class="grader-status-btn ldg-chip' +
          (on ? ' ' + s[2] + ' is-on is-' + s[0].toLowerCase() : '') +
          '" aria-pressed="' +
          on +
          '" tabindex="-1" data-action="toggleStudentStatus" data-aid="' +
          aid +
          '" data-sid="' +
          sid +
          '" data-status="' +
          s[0] +
          '" data-stop-prop="true"' +
          _statusLockAttrs(aid, sid, s[0]) +
          '>' +
          s[1] +
          '</button>'
        );
      }).join('<span class="grader-status-sep" aria-hidden="true"></span>') +
      '</div>'
    );
  }

  /* The row's Overall Comment: the grid's field, in the row after the
     status (rsgOverallComment saves it). */
  function ledgerOverallCommentHtml(cid, aid, st) {
    return (
      '<div class="ldg-overall">' +
      _overallCommentFieldHtml(cid, aid, st, 'rsg-overall-comment ldg-overall-comment') +
      '</div>'
    );
  }

  function ledgerRowOpen(kind, aid, st, stStatus) {
    var disableRow = stStatus && stStatus !== 'LATE';
    // Draft or Returned beside the name (S1-F2); '' in a class that holds
    // no grades, where the row is as it was.
    var mark = _returnMarkHtml(pageState.activeCourse, aid, st.id);
    var group = _groupRowFor(aid, st.id);
    // The work icon, as on a rubric's or competencies' rows (Colin, Nov 16:
    // every kind of work takes Add Work and See the Work). A group's row
    // has none, as there.
    var work = group && group.view ? '' : _workIconHtml(pageState.activeCourse, aid, st);
    var wrap = mark || work;
    return (
      '<div class="score-row ldg-row ldg-' +
      kind +
      (disableRow ? ' has-status' : '') +
      (stStatus === 'LATE' ? ' has-late' : '') +
      '"' +
      (kind === 'cmp' ? ' tabindex="0"' : '') +
      ' data-status-student="' +
      st.id +
      '" data-status-assess="' +
      aid +
      '">' +
      '<span class="ldg-name' +
      (wrap ? ' ldg-name-ret' : '') +
      (work ? ' ldg-name-work' : '') +
      '">' +
      (wrap ? '<span class="ldg-name-text">' : '') +
      esc(group && group.view ? group.view.label : displayNameWithLast(st)) +
      (wrap ? '</span>' + mark + work : '') +
      '</span>'
    );
  }

  /* Class Results (teacher/class-results.js) opens from a card's header and
     from the class line under its scores; class-results.js listens for
     data-action="classResults". */
  var _CLASS_RESULTS_ICON =
    '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 16v-3"/><path d="M8 16v-6"/><path d="M12 16v-9"/><path d="M16 16V4"/></svg>';
  function _classResultsAttrs(cid, aid) {
    return (
      ' data-action="classResults" data-cid="' + esc(cid) + '" data-aid="' + esc(aid) + '" title="View Class Results"'
    );
  }
  function _classResultsLinkHtml(cid, aid) {
    return (
      '<button type="button" class="ldg-name cr-ldg-link"' + _classResultsAttrs(cid, aid) + '>Class Results</button>'
    );
  }

  function _refreshClassResultsSoon() {
    if (pageState._crRefreshQueued || !window.ClassResults || !ClassResults.isOpen()) return;
    pageState._crRefreshQueued = true;
    requestAnimationFrame(function () {
      pageState._crRefreshQueued = false;
      if (window.ClassResults && ClassResults.isOpen()) ClassResults.refresh();
    });
  }

  // Counts read from the rows on screen, so they follow every click without a re-render.
  function refreshLedgerSummary(grid) {
    if (!grid) return;
    var rows = grid.querySelectorAll('.ldg-row');
    var tally = grid.querySelector('.ldg-tally');
    if (!tally) return;
    if (grid.classList.contains('cmp-grid')) {
      var n = { c: 0, i: 0, u: 0 };
      rows.forEach(function (r) {
        if (r.classList.contains('has-status')) return;
        if (r.querySelector('.cmp-complete.active')) n.c++;
        else if (r.querySelector('.cmp-incomplete.active')) n.i++;
        else n.u++;
      });
      // html-safe: the three counts are numbers; the class and assessment ids are escaped
      tally.innerHTML =
        '<span><b>' +
        n.c +
        '</b> Complete</span><span><b>' +
        n.i +
        '</b> Incomplete</span><span><b>' +
        n.u +
        '</b> Unmarked</span>' +
        (grid.dataset.aid ? _classResultsLinkHtml(pageState.activeCourse, grid.dataset.aid) : '');
      _refreshClassResultsSoon();
      return;
    }
    var max = parseFloat(grid.dataset.max) || 100;
    var vals = [];
    var left = 0;
    // Missing counts as 0 in the Average, as in the course % and the
    // gradebook's Class Average (classColumnAverage); Excused is left out.
    var missing = 0;
    rows.forEach(function (r) {
      if (r.classList.contains('has-status')) {
        if (r.querySelector('[data-status="NS"][aria-pressed="true"]')) missing++;
        return;
      }
      var inp = r.querySelector('.gb-pts-input');
      var v = inp ? parsePointsInput(inp.value, max) : null;
      if (v == null) left++;
      else vals.push(v);
    });
    var html = '<span><b>' + vals.length + '</b> Marked</span><span><b>' + left + '</b> Unmarked</span>';
    var stats = grid.querySelector('.ldg-stats');
    // Median, Lowest and Highest count Missing as 0 too, so the line uses
    // one rule (Nov 3 sweep: the Average counted it, the rest left it out).
    var counted = vals.slice();
    for (var m = 0; m < missing; m++) counted.push(0);
    if (counted.length) {
      var sorted = counted.slice().sort(function (x, y) {
        return x - y;
      });
      var sum = counted.reduce(function (x, y) {
        return x + y;
      }, 0);
      // calc.js's median, so this line and Class Results agree.
      var mid = medianOf(counted);
      html += '<span>Average <b>' + formatPointsPercent(sum / counted.length, max) + '</b></span>';
      if (stats)
        // html-safe: figures from formatPoints; the class and assessment ids are escaped
        stats.innerHTML =
          (grid.dataset.aid
            ? _classResultsLinkHtml(pageState.activeCourse, grid.dataset.aid)
            : '<span class="ldg-name">Class</span>') +
          '<span>Median <b>' +
          formatPoints(mid) +
          ' / ' +
          max +
          '</b></span><span>Lowest <b>' +
          formatPoints(sorted[0]) +
          ' / ' +
          max +
          '</b></span><span>Highest <b>' +
          formatPoints(sorted[sorted.length - 1]) +
          ' / ' +
          max +
          '</b></span>';
    } else if (stats) stats.innerHTML = '';
    tally.innerHTML = html;
    _refreshClassResultsSoon();
  }

  function renderCompletionGrid(cid, a, students) {
    var statuses = getAssignmentStatuses(cid);
    var html =
      '<div class="ldg-grid cmp-grid" data-aid="' +
      a.id +
      '">' +
      '<div class="ldg-bar"><span class="ldg-tally"></span>' +
      '<div class="ldg-actions"><button type="button" class="ldg-action" data-action="confirmFillNotSubmitted" data-aid="' +
      a.id +
      '">Set Unmarked to Missing</button>' +
      '<button type="button" class="ldg-action cmp-fill-all" data-action="confirmFillCompletion" data-aid="' +
      a.id +
      '">Set Unmarked to Complete</button></div></div>' +
      '<div class="ldg-head"><span>Student</span><span>Mark</span><span>Status</span><span>Overall Comment</span></div>';
    students.forEach(function (st) {
      var stStatus = statuses[st.id + ':' + a.id] || null;
      html +=
        ledgerRowOpen('cmp', a.id, st, stStatus) +
        '<div class="cmp-cell">' +
        completionButtonsHtml(a.id, st.id, getCompletionMark(cid, st.id, a.id)) +
        '</div>' +
        _ledgerStatusOrNoteHtml(a.id, st.id, stStatus) +
        ledgerOverallCommentHtml(cid, a.id, st) +
        '</div>' +
        _ledgerMembersHtml(cid, a.id, st.id);
    });
    html += '</div>';
    return html;
  }

  /* Complete/Incomplete rows answer single keys while the row has focus:
     C and I mark and move down, L toggles Late, M opens comments, arrows move. */
  function handleLedgerKey(e, row) {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    var step = function (dir) {
      var n = dir > 0 ? row.nextElementSibling : row.previousElementSibling;
      if (n && n.classList.contains('ldg-row')) n.focus();
    };
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      step(k === 'ArrowDown' ? 1 : -1);
      return true;
    }
    var target = /** @type {any} */ (null);
    if (k === 'c') target = row.querySelector('.cmp-complete');
    else if (k === 'i') target = row.querySelector('.cmp-incomplete');
    else if (k === 'l') target = row.querySelector('.ldg-chip[data-status="LATE"]');
    else if (k === 'm') target = row.querySelector('.ldg-note');
    if (!target) return false;
    e.preventDefault();
    target.click();
    if (k === 'c' || k === 'i') step(1);
    else if (k === 'l') row.focus();
    return true;
  }

  // Clicking the active mark again clears it.
  function setCompletion(el) {
    var cid = pageState.activeCourse;
    var aid = el.dataset.aid;
    var sid = el.dataset.sid;
    var next = getCompletionMark(cid, sid, aid) === el.dataset.mark ? null : el.dataset.mark;
    // Missing and Excused work takes no mark (isScoreLocked); C and I reach here by key.
    if (next && isScoreLocked(cid, sid, aid)) return;
    Grader.setMark(cid, sid, aid, next);
    var cell = el.closest('.cmp-cell');
    var grid = el.closest('.ldg-grid');
    if (cell) cell.innerHTML = completionButtonsHtml(aid, sid, next);
    refreshLedgerSummary(grid);
    refreshSidebarGrades(sid);
  }

  function confirmFillCompletion(aid) {
    showConfirm(
      'Set Unmarked to Complete',
      'Set every unmarked student to Complete?',
      'Set to Complete',
      'primary',
      function () {
        var cid = pageState.activeCourse;
        var prevScores = structuredClone(getScores(cid));
        var statuses = getAssignmentStatuses(cid);
        getStudents(cid).forEach(function (st) {
          if (statuses[st.id + ':' + aid] || getCompletionMark(cid, st.id, aid)) return;
          Grader.setMark(cid, st.id, aid, 'complete');
        });
        render();
        refreshSidebarGrades();
        var filled = structuredClone(getScores(cid));
        showUndoToast('Unmarked students set to Complete', function () {
          Grader.undo(cid, prevScores, filled);
          render();
          refreshSidebarGrades();
        });
      },
    );
  }

  function renderPointsGrid(cid, a, students, scores) {
    var max = Number(a.maxPoints) || 100;
    var statuses = getAssignmentStatuses(cid);
    var html =
      '<div class="ldg-grid pts-grid" data-aid="' +
      a.id +
      '" data-max="' +
      max +
      '">' +
      '<div class="ldg-bar"><span class="ldg-tally"></span>' +
      '<div class="ldg-actions"><button type="button" class="ldg-action" data-action="confirmFillNotSubmitted" data-aid="' +
      a.id +
      '">Set Unmarked to Missing</button>' +
      '<button type="button" class="ldg-action" data-action="confirmFillPoints" data-aid="' +
      a.id +
      '">Set Unmarked to ' +
      max +
      ' / ' +
      max +
      '</button></div></div>';
    students.forEach(function (st) {
      var raw = getPointsScore(cid, st.id, a.id);
      var stStatus = statuses[st.id + ':' + a.id] || null;
      var disableRow = stStatus && stStatus !== 'LATE';
      html +=
        ledgerRowOpen('pts', a.id, st, stStatus) +
        '<div class="pts-input-cell">' +
        '<input type="text" class="gb-pts-input ldg-pts-input" inputmode="decimal" autocomplete="off" aria-label="Score for ' +
        esc(displayNameWithLast(st)) +
        '" value="' +
        (raw != null ? formatPoints(raw) : '') +
        '" data-sid="' +
        st.id +
        '" data-aid="' +
        a.id +
        '" data-max="' +
        max +
        '"' +
        (disableRow ? ' disabled' : '') +
        '>' +
        '<span class="gb-pts-max">/ ' +
        max +
        '</span>' +
        FactorField.chipHtml(a, raw, max) +
        '<span class="gb-pts-live-pct">' +
        pointsPctHtml(raw, max, 0) +
        '</span>' +
        '</div>' +
        _ledgerStatusOrNoteHtml(a.id, st.id, stStatus) +
        ledgerOverallCommentHtml(cid, a.id, st) +
        '</div>' +
        _ledgerMembersHtml(cid, a.id, st.id);
    });
    html += '<div class="ldg-stats"></div>' + '</div>';
    return html;
  }

  // Every student with no score and no status becomes Missing, with undo.
  function confirmFillNotSubmitted(aid) {
    showConfirm(
      'Set Unmarked to Missing',
      'Set every unmarked student to Missing?',
      'Set to Missing',
      'primary',
      function () {
        var cid = pageState.activeCourse;
        var statuses = getAssignmentStatuses(cid);
        var marked = [];
        getStudents(cid).forEach(function (st) {
          if (statuses[st.id + ':' + aid] || getPointsScore(cid, st.id, aid) != null) return;
          if (!canSetAssignmentStatus(cid, st.id, aid, 'NS')) return;
          Grader.setStatus(cid, st.id, aid, 'NS');
          marked.push(st.id);
        });
        render();
        refreshSidebarGrades();
        if (!marked.length) return;
        showUndoToast('Unmarked students set to Missing', function () {
          marked.forEach(function (sid) {
            Grader.undoMissing(cid, sid, aid);
          });
          render();
          refreshSidebarGrades();
        });
      },
    );
  }

  function confirmFillPoints(aid) {
    var cid = pageState.activeCourse;
    var a = getAssessments(cid).find(function (x) {
      return x.id === aid;
    });
    if (!a) return;
    var max = a.maxPoints || 100;
    var label = max + ' / ' + max;
    showConfirm(
      'Set Unmarked to ' + label,
      'Set every unmarked student to ' + label + '?',
      'Set to ' + label,
      'primary',
      function () {
        var prevScores = structuredClone(getScores(cid));
        var statuses = getAssignmentStatuses(cid);
        getStudents(cid).forEach(function (st) {
          // Same rule as Set Unmarked to Complete: any status, Late included, is left alone.
          if (statuses[st.id + ':' + aid] || getPointsScore(cid, st.id, aid) != null) return;
          Grader.setPoints(cid, st.id, aid, max);
        });
        render();
        refreshSidebarGrades();
        var filled = structuredClone(getScores(cid));
        showUndoToast('Unmarked students set to ' + label, function () {
          Grader.undo(cid, prevScores, filled);
          render();
          refreshSidebarGrades();
        });
      },
    );
  }

  function livePointsUpdate(inp) {
    var max = parseFloat(inp.dataset.max) || 100;
    var pctSpan = inp.closest('.score-row').querySelector('.gb-pts-live-pct');
    if (pctSpan) pctSpan.innerHTML = pointsPctHtml(parsePointsInput(inp.value, max), max, 0);
    FactorField.refreshChip(inp.closest('.score-row'), parsePointsInput(inp.value, max), max);
  }
  function commitPointsScore(inp) {
    var cid = pageState.activeCourse;
    var sid = inp.dataset.sid;
    var aid = inp.dataset.aid;
    var max = parseFloat(inp.dataset.max) || 100;
    // A typo that isn't a number puts the saved score back; only a blank
    // box clears.
    var prev = getPointsScore(cid, sid, aid);
    var over = _pointsOverLimit(inp.value, max);
    var raw = parsePointsInput(inp.value, max, prev);
    inp.value = raw != null ? formatPoints(raw) : '';
    // Leaving a field without changing it saves nothing; an untouched blank
    // field used to write a 0. A typed 0 is a score; blank clears.
    if (raw === prev) return;
    // Grader.setPoints saves the one score, as the gradebook and phone do. A
    // second write under the assessment's own id left a stray entry and
    // sent the score twice.
    Grader.setPoints(cid, sid, aid, raw);
    livePointsUpdate(inp); // the % and the factored score, from the box as saved
    refreshLedgerSummary(inp.closest('.ldg-grid'));
    if (over != null) _sayPointsCapped(cid, sid, aid, over, raw, max, prev);
  }
  /* Extra credit goes up to twice the maximum (D4), and a score typed above
     that is saved at the limit. That used to happen without a word, so a
     typo such as 45 for 4.5 became a perfect double score (Nov 3 sweep).
     The toast says what was saved, and Undo puts back the score before. */
  function _pointsOverLimit(text, max) {
    var n = parseFloat(
      String(text == null ? '' : text)
        .trim()
        .replace(',', '.'),
    );
    return max > 0 && isFinite(n) && n > max * POINTS_EXTRA_CREDIT_FACTOR ? n : null;
  }
  function _sayPointsCapped(cid, sid, aid, typed, saved, max, prev) {
    _showFillUndo(
      formatPoints(typed) +
        ' is more than twice the ' +
        formatPoints(max) +
        '-point maximum, so it was saved as ' +
        formatPoints(saved) +
        '.',
      function () {
        Grader.setPoints(cid, sid, aid, prev);
        render();
        refreshSidebarGrades(sid);
      },
    );
  }
  // The next (or previous) score box that is open for typing.
  function focusPointsBox(row, dir) {
    var r = row;
    while ((r = dir > 0 ? r.nextElementSibling : r.previousElementSibling)) {
      var box = r.querySelector && r.querySelector('.gb-pts-input');
      if (box && !box.disabled) {
        box.focus();
        box.select();
        return;
      }
    }
  }
  var POINTS_STATUS_KEYS = { l: 'LATE', e: 'EXC', n: 'NS' };
  function handlePointsKey(e, inp) {
    var statusKey = !e.metaKey && !e.ctrlKey && !e.altKey && POINTS_STATUS_KEYS[e.key.toLowerCase()];
    if (statusKey) {
      // L, E or N in a score box: keep any number typed, then set Late,
      // Excused or Not Submitted. Excused and Not Submitted lock the box,
      // so focus moves on to the next open one.
      e.preventDefault();
      var srow = inp.closest('.score-row');
      var chip = srow && srow.querySelector('.ldg-chip[data-status="' + statusKey + '"]');
      if (!chip) return;
      commitPointsScore(inp);
      chip.click();
      if (inp.disabled) focusPointsBox(srow, 1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commitPointsScore(inp);
      focusPointsBox(inp.closest('.score-row'), 1);
    } else if (e.key === 'Escape') {
      var raw = getPointsScore(pageState.activeCourse, inp.dataset.sid, inp.dataset.aid);
      inp.value = raw != null ? formatPoints(raw) : '';
      inp.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      var next = inp.closest('.score-row').nextElementSibling;
      if (next) {
        var ni = next.querySelector('.gb-pts-input');
        if (ni) {
          ni.focus();
          ni.select();
        }
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      var prev = inp.closest('.score-row').previousElementSibling;
      if (prev) {
        var pi = prev.querySelector('.gb-pts-input');
        if (pi) {
          pi.focus();
          pi.select();
        }
      }
    }
  }

  function renderStatusToggles(aid, sid, currentStatus) {
    var cid = pageState.activeCourse;
    var commentCount = _assignmentCommentCount(cid, sid, aid);
    return (
      '<div class="student-status-toggles">' +
      '<button class="student-status-btn' +
      (currentStatus === 'EXC' ? ' active-excused' : '') +
      '" tabindex="-1" data-action="toggleStudentStatus" data-aid="' +
      aid +
      '" data-sid="' +
      sid +
      '" data-status="EXC" data-stop-prop="true" title="Excused">EXC</button>' +
      '<button class="student-status-btn' +
      (currentStatus === 'NS' ? ' active-ns' : '') +
      '" tabindex="-1" data-action="toggleStudentStatus" data-aid="' +
      aid +
      '" data-sid="' +
      sid +
      '" data-status="NS" data-stop-prop="true" title="Missing">M</button>' +
      '<button class="comment-btn" data-action="openCommentPopover" data-cid="' +
      cid +
      '" data-sid="' +
      sid +
      '" data-aid="' +
      aid +
      '" data-stop-prop="true" title="Comments">Comment' +
      (commentCount > 0 ? ' <span class="comment-count">' + commentCount + '</span>' : '') +
      '</button>' +
      '</div>' +
      '<div class="student-status-toggles student-status-row2">' +
      '<button class="student-status-btn student-status-late' +
      (currentStatus === 'LATE' ? ' active-late' : '') +
      '" tabindex="-1" data-action="toggleStudentStatus" data-aid="' +
      aid +
      '" data-sid="' +
      sid +
      '" data-status="LATE" data-stop-prop="true" title="Late">LATE</button>' +
      '</div>'
    );
  }

  function toggleStudentStatus(aid, sid, status) {
    var debounceKey = sid + ':' + aid + ':' + status;
    if (pageState._statusDebounce[debounceKey]) return;
    pageState._statusDebounce[debounceKey] = true;
    setTimeout(function () {
      delete pageState._statusDebounce[debounceKey];
    }, 300);
    var cid = pageState.activeCourse;
    var current = getAssignmentStatus(cid, sid, aid);
    var newStatus = current === status ? null : status;
    if (!canSetAssignmentStatus(cid, sid, aid, newStatus)) return;
    var clearedScores = Grader.setStatus(cid, sid, aid, newStatus);
    /** @type {any} */ var row =
      document.querySelector('.score-row[data-status-student="' + sid + '"][data-status-assess="' + aid + '"]') ||
      document.querySelector('.rsg-student[data-status-student="' + sid + '"][data-status-assess="' + aid + '"]');
    if (row) {
      row.querySelectorAll('.student-status-btn, .ldg-chip').forEach(function (btn) {
        btn.classList.remove('active-excused', 'active-ns', 'active-late');
        if (btn.classList.contains('ldg-chip'))
          btn.setAttribute('aria-pressed', String(/** @type {any} */ (btn).dataset.status === newStatus));
      });
      // The grid's Missing | Excused | Late control.
      row.querySelectorAll('.grader-status-btn').forEach(function (btn) {
        var on = /** @type {any} */ (btn).dataset.status === newStatus;
        btn.classList.remove('is-on', 'is-ns', 'is-exc', 'is-late');
        if (on) btn.classList.add('is-on', 'is-' + newStatus.toLowerCase());
        btn.setAttribute('aria-pressed', String(on));
      });
      if (newStatus === 'EXC') row.querySelector('[data-status="EXC"]').classList.add('active-excused');
      else if (newStatus === 'NS') row.querySelector('[data-status="NS"]').classList.add('active-ns');
      else if (newStatus === 'LATE') row.querySelector('[data-status="LATE"]').classList.add('active-late');
      // Late doesn't disable scoring — student submitted, just late
      var disableScoring = newStatus && newStatus !== 'LATE';
      if (disableScoring) row.classList.add('has-status');
      else row.classList.remove('has-status');
      if (newStatus === 'LATE') row.classList.add('has-late');
      else row.classList.remove('has-late');
      var ptsInput = /** @type {any} */ (row.querySelector('.gb-pts-input'));
      if (ptsInput) ptsInput.disabled = disableScoring;
      if (clearedScores) {
        row.querySelectorAll('.score-opt, .rsg-level, .cmp-btn').forEach(function (el) {
          el.classList.remove('active', 'mixed');
        });
        row.querySelectorAll('.rsg-criterion-row').forEach(syncModRow);
      }
      refreshLedgerSummary(row.closest('.ldg-grid'));
      // DIBELS counts leave out Missing and Excused students.
      if (row.closest('.dbl-grid')) render();
    } else if (!pageState._grader && document.querySelector('.grader-inline')) {
      // One student's grader on the page: redraw its status, lock and grade.
      render();
    }
    // Group work: a member's status can change which member the group's
    // rows come from, and the strip has no row of its own to update.
    if (!pageState._grader && _groupRows[aid]) render();
    refreshSidebarGrades(sid);
  }

  return {
    configure: configure,
    _CLASS_RESULTS_ICON: _CLASS_RESULTS_ICON,
    _pointsOverLimit: _pointsOverLimit,
    _refreshClassResultsSoon: _refreshClassResultsSoon,
    _sayPointsCapped: _sayPointsCapped,
    commitPointsScore: commitPointsScore,
    confirmFillCompletion: confirmFillCompletion,
    confirmFillNotSubmitted: confirmFillNotSubmitted,
    confirmFillPoints: confirmFillPoints,
    handleLedgerKey: handleLedgerKey,
    handlePointsKey: handlePointsKey,
    ledgerStatusHtml: ledgerStatusHtml,
    livePointsUpdate: livePointsUpdate,
    refreshLedgerSummary: refreshLedgerSummary,
    renderCompletionGrid: renderCompletionGrid,
    renderPointsGrid: renderPointsGrid,
    setCompletion: setCompletion,
    toggleStudentStatus: toggleStudentStatus,
  };
})();
