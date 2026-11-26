// @ts-check
/* assign-grader-parts.js — The grader's parts. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignGraderParts = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var _countsAsText,
    _dibelsLevelPillsHtml,
    _focusGraderPoints,
    _graderHtml,
    _graderToTop,
    _printMarkHtml,
    _scoreTagObjs,
    pageState,
    render,
    _graderForgetDrawn,
    _graderGrade,
    _graderShortLevels,
    _graderShowOn,
    _graderShowWanted,
    _graderStops,
    _holdsGrades,
    _inlineReturnRowHtml,
    _inlineWorkHtml,
    _nextShownStop,
    _refreshGraderReturn,
    _refreshGraderRevision,
    _refreshGraderShow,
    _refreshGraderWas,
    _refreshGraderWorkLine,
    _refreshReportNote,
    _returnDrafts,
    _returnsAfterEvent,
    _stopShown,
    _workFitSaved,
    _workStudent,
    closeGrader;
  function configure(h) {
    if ('_countsAsText' in h) _countsAsText = h._countsAsText;
    if ('_dibelsLevelPillsHtml' in h) _dibelsLevelPillsHtml = h._dibelsLevelPillsHtml;
    if ('_focusGraderPoints' in h) _focusGraderPoints = h._focusGraderPoints;
    if ('_graderHtml' in h) _graderHtml = h._graderHtml;
    if ('_graderToTop' in h) _graderToTop = h._graderToTop;
    if ('_printMarkHtml' in h) _printMarkHtml = h._printMarkHtml;
    if ('_scoreTagObjs' in h) _scoreTagObjs = h._scoreTagObjs;
    if ('pageState' in h) pageState = h.pageState;
    if ('render' in h) render = h.render;
    if ('_graderForgetDrawn' in h) _graderForgetDrawn = h._graderForgetDrawn;
    if ('_graderGrade' in h) _graderGrade = h._graderGrade;
    if ('_graderShortLevels' in h) _graderShortLevels = h._graderShortLevels;
    if ('_graderShowOn' in h) _graderShowOn = h._graderShowOn;
    if ('_graderShowWanted' in h) _graderShowWanted = h._graderShowWanted;
    if ('_graderStops' in h) _graderStops = h._graderStops;
    if ('_holdsGrades' in h) _holdsGrades = h._holdsGrades;
    if ('_inlineReturnRowHtml' in h) _inlineReturnRowHtml = h._inlineReturnRowHtml;
    if ('_inlineWorkHtml' in h) _inlineWorkHtml = h._inlineWorkHtml;
    if ('_nextShownStop' in h) _nextShownStop = h._nextShownStop;
    if ('_refreshGraderReturn' in h) _refreshGraderReturn = h._refreshGraderReturn;
    if ('_refreshGraderRevision' in h) _refreshGraderRevision = h._refreshGraderRevision;
    if ('_refreshGraderShow' in h) _refreshGraderShow = h._refreshGraderShow;
    if ('_refreshGraderWas' in h) _refreshGraderWas = h._refreshGraderWas;
    if ('_refreshGraderWorkLine' in h) _refreshGraderWorkLine = h._refreshGraderWorkLine;
    if ('_refreshReportNote' in h) _refreshReportNote = h._refreshReportNote;
    if ('_returnDrafts' in h) _returnDrafts = h._returnDrafts;
    if ('_returnsAfterEvent' in h) _returnsAfterEvent = h._returnsAfterEvent;
    if ('_stopShown' in h) _stopShown = h._stopShown;
    if ('_workFitSaved' in h) _workFitSaved = h._workFitSaved;
    if ('_workStudent' in h) _workStudent = h._workStudent;
    if ('closeGrader' in h) closeGrader = h.closeGrader;
  }

  /* ── Grader parts (S6-T1) ─────────────────────────────────
     The dialog is put together from four parts, each with its own markup
     and its own drawing, so a work pane can sit beside the scoring
     without either knowing where the other is:
     - the toolbar: Print, the title, Needs a Category, Counts As, Done;
     - the head: ← the student's (or group's) name →, Printed, and the
       Missing | Excused | Late control;
     - the panel: Graded Separately From, the members card, the grading
       controls and the Note for the Report;
     - the foot: the hint and the grade.
     Today they sit as they always have: the head and the panel share the
     part that scrolls, between the toolbar and the foot, and the markup is
     the same to the byte (tests/fixtures/assignments-switch-off.json).
     Each part is drawn and refreshed through its own root, found by
     _graderPart, so a layout that moves the head above a work pane, or the
     panel into a column of its own, changes the shell and nothing else.
     The panel is four siblings, not one box: its root is the element that
     holds them (today the scrolling part). */
  // html-safe: fixed markup
  function _graderToolbarHtml() {
    return (
      '<div class="grader-toolbar">' +
      '<div class="grader-toolbar-start"></div>' +
      '<div class="grader-title-wrap"><h2 class="grader-title" id="grader-title"></h2>' +
      '<span class="type-badge type-badge-needs grader-needs-category" hidden></span>' +
      '<p class="grader-counts-as"></p></div>' +
      '<div class="grader-toolbar-end"><button type="button" class="grader-done" data-grader="close">Done</button></div>' +
      '</div>'
    );
  }

  // html-safe: fixed markup and icon constants
  function _graderHeadHtml() {
    return (
      '<div class="grader-student-row">' +
      '<button type="button" class="grader-step" data-grader="prev" aria-label="Previous student">' +
      _GRADER_CHEVRON_LEFT +
      '</button>' +
      '<h1 class="grader-student"></h1>' +
      '<button type="button" class="grader-step" data-grader="next" aria-label="Next student">' +
      _GRADER_CHEVRON_RIGHT +
      '</button>' +
      '<span class="grader-print-mark"></span>' +
      '<span class="grader-spacer"></span>' +
      '<div class="grader-status" role="group" aria-label="Status"></div>' +
      '</div>'
    );
  }

  // html-safe: fixed markup
  function _graderPanelHtml() {
    return (
      '<div class="grader-separate-line" hidden></div>' +
      '<section class="grader-members" aria-labelledby="grader-members-title" hidden></section>' +
      '<div class="grader-body"></div>' +
      // Closed unless a note is written (Colin, Nov 13: teachers were
      // confused by the open box). One quiet line until it is opened.
      '<details class="grader-report-note">' +
      '<summary class="grader-report-note-head"><h2 id="grader-report-note-title">Note for the Report</h2>' +
      '<span class="grader-report-note-opt">Optional</span></summary>' +
      '<div class="grader-report-note-body">' +
      '<p class="grader-report-note-what">If this is the student\u2019s best piece, their report comment names it. Write what they did well and the comment adds it.</p>' +
      '<input type="text" class="grader-report-note-input" aria-label="Note for the report" ' +
      'placeholder="e.g. used evidence from two sources to explain the causes" ' +
      'aria-describedby="grader-report-note-preview" maxlength="300" autocomplete="off">' +
      '<p class="grader-report-note-preview" id="grader-report-note-preview"></p>' +
      '</div>' +
      '</details>'
    );
  }

  // html-safe: fixed markup
  function _graderFootHtml() {
    return (
      '<div class="grader-foot">' +
      '<span class="grader-hint">← → change student · Esc closes</span>' +
      '<span class="grader-grade-label">Grade</span><span class="grader-grade"></span>' +
      '</div>'
    );
  }

  // The dialog as it has always been laid out.
  // html-safe: the parts' fixed markup
  function _graderShellHtml() {
    return (
      _graderToolbarHtml() +
      '<div class="grader-scroll">' +
      _graderHeadHtml() +
      _graderPanelHtml() +
      '</div>' +
      _graderFootHtml()
    );
  }

  /* A part's root in the dialog: the head's row; the element holding the
     panel's pieces; the toolbar; the foot. Null when the dialog has none. */
  function _graderPart(dialog, part) {
    if (!dialog) return null;
    if (part === 'head') return dialog.querySelector('.grader-student-row');
    if (part === 'panel') {
      var body = dialog.querySelector('.grader-body');
      return body ? body.parentNode : null;
    }
    if (part === 'toolbar') return dialog.querySelector('.grader-toolbar');
    if (part === 'foot') return dialog.querySelector('.grader-foot');
    return null;
  }

  function _drawGraderToolbar(dialog, cid, a) {
    var bar = _graderPart(dialog, 'toolbar');
    bar.querySelector('.grader-title').textContent = a.title || 'Assessment';
    bar.querySelector('.grader-counts-as').textContent = _countsAsText(cid, a);
    var needsCat = bar.querySelector('.grader-needs-category');
    needsCat.hidden = !assessmentNeedsCategory(cid, a);
    needsCat.textContent = NEEDS_CATEGORY_LABEL;
    needsCat.title = NEEDS_CATEGORY_TIP;
    // html-safe: _graderPrintButton is fixed labels and our id
    bar.querySelector('.grader-toolbar-start').innerHTML = _graderPrintButton(cid, a);
  }

  /* The head for `st` (the member a group's grade is drawn from, when
     `view` is a group): the name, and ← → off at either end. */
  function _drawGraderHead(head, cid, a, st, view) {
    var i = pageState._grader.studentIds.indexOf(st.id);
    var steps = _graderSteps(cid, a);
    var u = steps ? _graderUnitIndex(steps, st.id) : -1;
    var prev = head.querySelector('[data-grader="prev"]');
    var next = head.querySelector('[data-grader="next"]');
    head.querySelector('.grader-student').textContent = view ? view.label : displayNameWithLast(st);
    prev.disabled = steps ? !(u > 0) : !(i > 0);
    next.disabled = steps
      ? !(u >= 0 && u < steps.length - 1)
      : !(i >= 0 && i < pageState._grader.studentIds.length - 1);
    prev.setAttribute('aria-label', view ? 'Previous' : 'Previous student');
    next.setAttribute('aria-label', view ? 'Next' : 'Next student');
  }

  // The grading controls for `st`.
  function _drawGraderPanel(panel, cid, a, st) {
    var body = panel.querySelector('.grader-body');
    // Students in This Group may sit among the criteria: keep it out of
    // the redraw (_placeGroupMembers puts it back).
    var members = panel.querySelector('.grader-members');
    if (members && body.contains(members)) body.parentNode.insertBefore(members, body);
    // html-safe: a.id is our id; _graderHtml is reviewed
    body.innerHTML =
      '<div class="assess-card open active" id="ac-' +
      a.id +
      '"><div class="assess-body">' +
      _graderHtml(cid, a, _scoreTagObjs(cid, a), [st], getScores(cid), true) +
      '</div></div>';
  }

  /* The head after a click: the Missing | Excused | Late control (none on
     a group, whose members each have their own) and Printed beside the
     name. Each is redrawn only when it changes: pressing a button moves
     focus, which runs this, and new buttons under the mouse before it is
     released lose the click. */
  function _refreshGraderHead(head, cid, a, sid, view) {
    var status = getAssignmentStatus(cid, sid, a.id);
    // A DIBELS benchmark is given on the day or not at all: no Late.
    var statusHtml = _graderStatusButtons(a.id, sid, status, isDibelsScored(a) ? ['NS', 'EXC'] : ['NS', 'EXC', 'LATE']);
    var statusBox = head.querySelector('.grader-status');
    if (pageState._grader.statusHtml !== statusHtml) {
      // html-safe: statusHtml is built by _graderStatusButtons
      if (!_patchStatusButtons(statusBox, statusHtml)) statusBox.innerHTML = statusHtml;
      pageState._grader.statusHtml = statusHtml;
    }
    statusBox.hidden = !!view;
    // Printed / Changed Since Printed beside the name (teacher/rubric-print.js).
    var markHtml = view ? '' : _printMarkHtml(cid, a.id, sid);
    var markBox = head.querySelector('.grader-print-mark');
    if (markBox && pageState._grader.markHtml !== markHtml) {
      // html-safe: _printMarkHtml is RubricPrint.markHtml, which escapes its text
      markBox.innerHTML = markHtml;
      pageState._grader.markHtml = markHtml;
    }
  }

  /* The panel after a click: the members card and the Graded Separately
     From line, the controls set aside under Missing or Excused, and the
     Note for the Report (one student's; the group view has none). */
  function _refreshGraderPanel(panel, cid, a, sid, view) {
    _refreshGroupChrome(panel, cid, a, sid, view);
    var status = getAssignmentStatus(cid, sid, a.id);
    // Missing and Excused set the grading controls aside, as the grids do.
    panel.querySelector('.grader-body').classList.toggle('is-locked', status === 'NS' || status === 'EXC');
    _refreshReportNote(panel, cid, a, sid);
    if (view) panel.querySelector('.grader-report-note').hidden = true;
  }

  var _GRADER_CHEVRON_LEFT =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
  var _GRADER_CHEVRON_RIGHT =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
  var _GRADER_PRINTER =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/></svg>';

  /* The card's label for the same print: Print Rubrics on rubric and
     competency-level work (a graded rubric), Print Scores on points and
     Complete/Incomplete work (the score or mark and feedback); none on DIBELS. */
  // html-safe: fixed labels and icon; a.id is our id
  function _graderPrintButton(cid, a) {
    if (isDibelsScored(a)) return '';
    var hasRubric = a.rubricId && getRubricById(cid, a.rubricId);
    var label = !hasRubric && isPointsScored(a) ? 'Print Scores' : 'Print Rubrics';
    return (
      '<button type="button" class="grader-print" data-action="printRubrics" data-aid="' +
      a.id +
      '">' +
      _GRADER_PRINTER +
      label +
      '</button>'
    );
  }

  var _SUGGESTED_ICON =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>';
  var _NOT_SCORED_ICON =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/></svg>';

  var _GRADER_STATUS_LABELS = { NS: 'Missing', EXC: 'Excused', LATE: 'Late' };
  // Missing and Excused are greyed out on work with a score or feedback
  // (canSetAssignmentStatus, shared/data.js).
  // It says why, and what to do (Nov 3 sweep).
  var _STATUS_LOCKED_TITLE =
    'This student has a score or feedback on this work. Clear it first to mark Missing or Excused.';
  function _statusLockAttrs(aid, sid, key) {
    return canSetAssignmentStatus(pageState.activeCourse, sid, aid, key)
      ? ''
      : ' disabled title="' + _STATUS_LOCKED_TITLE + '"';
  }
  // Brings the status buttons up to date after a score or comment changes,
  // without redrawing anything: every one on the page, or those of the
  // piece of work (and student) in `scope` (_eventScope).
  function _syncStatusLocks(scope) {
    var sel = '[data-action="toggleStudentStatus"]';
    if (scope) sel += '[data-aid="' + scope.aid + '"]' + (scope.sid ? '[data-sid="' + scope.sid + '"]' : '');
    document.querySelectorAll(sel).forEach(function (btn) {
      var locked = !canSetAssignmentStatus(
        pageState.activeCourse,
        /** @type {any} */ (btn).dataset.sid,
        /** @type {any} */ (btn).dataset.aid,
        /** @type {any} */ (btn).dataset.status,
      );
      if (/** @type {any} */ (btn).disabled === locked) return;
      /** @type {any} */ (btn).disabled = locked;
      if (locked) /** @type {any} */ (btn).title = _STATUS_LOCKED_TITLE;
      else btn.removeAttribute('title');
    });
  }
  /* What an event on the page can have changed: one student's piece of
     work ({ aid, sid }), one piece ({ aid }), or anything (null). A click
     or key on a student's row is that student's, except on pair and group
     work, where one row writes every member. Elsewhere in a card (a
     column's fill, Set Everyone To) it is the card's; outside every card
     (a question's OK, Undo, the toolbar, Class Results) it is anything. */
  function _eventScope(e) {
    var t = e && e.target;
    var card = t && t.closest ? t.closest('.assess-card') : null;
    var main = document.getElementById('main');
    if (!card || !main || !main.contains(card)) return null;
    var row = t.closest('[data-sid], [data-student], [data-status-student]');
    var sid = row && card.contains(row) && (row.dataset.sid || row.dataset.student || row.dataset.statusStudent);
    return _gradingScope(card.id.slice(3), sid);
  }
  function _gradingScope(aid, sid) {
    var a = sid && _assessmentById(pageState.activeCourse, aid);
    return a && (!a.collaboration || a.collaboration === 'individual') ? { aid: aid, sid: sid } : { aid: aid };
  }
  // Typing in a box saves on Enter or on leaving it, so a key that is not
  // Enter there brings nothing up to date (a key was two page-wide sweeps).
  function _typingKey(e) {
    var t = e.target;
    if (e.type !== 'keyup' || e.key === 'Enter' || !t) return false;
    if (t.isContentEditable || t.tagName === 'TEXTAREA') return true;
    return (
      t.tagName === 'INPUT' && /^(text|search|number|email|url|tel|password)?$/i.test(t.getAttribute('type') || '')
    );
  }
  // After an event that may have saved a grade: the Missing | Excused locks,
  // then the Draft marks and counts to return (S1-F2), for what it touched.
  function _afterGradingEvent(e) {
    if (_typingKey(e)) return;
    var scope = _eventScope(e);
    setTimeout(function () {
      _syncStatusLocks(scope);
    }, 0);
    _returnsAfterEvent(scope);
  }
  // The Missing | Excused | Late control's buttons, in the order given.
  // html-safe: status keys and labels are constants; aid and sid are our ids
  function _graderStatusButtons(aid, sid, status, order) {
    return order
      .map(function (key) {
        var on = status === key;
        return (
          '<button type="button" class="grader-status-btn' +
          (on ? ' is-on is-' + key.toLowerCase() : '') +
          '" aria-pressed="' +
          on +
          '" data-action="toggleStudentStatus" data-aid="' +
          aid +
          '" data-sid="' +
          sid +
          '" data-status="' +
          key +
          '"' +
          _statusLockAttrs(aid, sid, key) +
          '>' +
          _GRADER_STATUS_LABELS[key] +
          '</button>'
        );
      })
      .join('<span class="grader-status-sep" aria-hidden="true"></span>');
  }

  /* One student open on the Assignments page: the dialog's grader inside
     the card, under a row with the student's name, the Missing | Excused |
     Late control, the arrow-key hint and the grade. */
  function _inlineGraderHtml(cid, a, tagObjs, st, scores) {
    var status = getAssignmentStatus(cid, st.id, a.id);
    var grade = _graderGrade(cid, a, st.id);
    return (
      '<div class="grader-inline' +
      (status === 'NS' || status === 'EXC' ? ' is-locked' : '') +
      '">' +
      '<div class="grader-inline-head">' +
      '<h4 class="grader-inline-name">' +
      esc(displayNameWithLast(st)) +
      '</h4>' +
      _printMarkHtml(cid, a.id, st.id) +
      '<div class="grader-status" role="group" aria-label="Status">' +
      _graderStatusButtons(a.id, st.id, status, isDibelsScored(a) ? ['NS', 'EXC'] : ['NS', 'EXC', 'LATE']) +
      '</div>' +
      _inlineWorkHtml(cid, a, st.id) +
      '<span class="grader-spacer"></span>' +
      '<span class="grader-hint">← → change student</span>' +
      (isDibelsScored(a)
        ? '<span class="grader-dibels-levels">' + _dibelsLevelPillsHtml(cid, a, st.id) + '</span>'
        : '<span class="grader-grade-label">Grade</span>' +
          '<span class="grader-grade' +
          (grade.tone ? ' tone-' + grade.tone : '') +
          '">' +
          esc(grade.text) +
          '</span>') +
      '</div>' +
      _graderHtml(cid, a, tagObjs, [st], scores, true) +
      _inlineReturnRowHtml(cid, a, st.id) +
      '</div>'
    );
  }

  /* ── Group work in the dialog (Group grading, shared/data.js) ──
     Pair and Group work is graded once per group: the dialog shows the
     group's name, a card of its members (each with their own Missing |
     Excused | Late and a ⋯ menu with Grade Separately), and the grading
     controls of the member the group's grade is copied from. A member
     graded separately gets their own view, as any student. ← → step group
     by group, each group followed by its members graded separately, then
     the students in no group. */
  var _GRADER_MORE_ICON =
    '<svg width="16" height="4" viewBox="0 0 16 4" aria-hidden="true"><circle cx="2" cy="2" r="1.8" fill="currentColor"/><circle cx="8" cy="2" r="1.8" fill="currentColor"/><circle cx="14" cy="2" r="1.8" fill="currentColor"/></svg>';

  // The group view for `sid` (a member still graded with their group), or
  // null: { group, label, members, linked, source } (groupGradingUnits).
  function _graderGroupView(cid, a, sid) {
    var units = _graderUnits(cid, a);
    var unit =
      units &&
      units.find(function (u) {
        return u.linked && u.linked.indexOf(sid) >= 0;
      });
    return unit ? Object.assign({ label: collabGroupLabel(unit.group) }, unit) : null;
  }

  // Group work's grading units in the class's last-name order (null on
  // other work).
  function _graderUnits(cid, a) {
    return groupGradingUnits(
      cid,
      a,
      sortStudents(getStudents(cid), 'lastName').map(function (s) {
        return s.id;
      }),
    );
  }
  // The student ids a unit stands for: a group's linked members, or one.
  function _unitIds(unit) {
    return unit.linked || [unit.sid];
  }
  function _graderUnitIndex(units, sid) {
    for (var i = 0; i < units.length; i++) if (_unitIds(units[i]).indexOf(sid) >= 0) return i;
    return -1;
  }
  // The dialog's steps: from the gradebook, only the units with a row on
  // screen, in the rows' order; otherwise every unit.
  function _graderSteps(cid, a) {
    var units = _graderUnits(cid, a);
    var rows = pageState._grader && pageState._grader.rowOrder;
    if (!units || !rows) return units;
    var at = function (unit) {
      return _unitIds(unit).reduce(function (best, id) {
        var i = rows.indexOf(id);
        return i >= 0 && (best < 0 || i < best) ? i : best;
      }, -1);
    };
    return units
      .filter(function (u) {
        return at(u) >= 0;
      })
      .sort(function (x, y) {
        return at(x) - at(y);
      });
  }

  /* ── The grader's queue (I3, docs/plans/inbox-redesign-plan.md) ──
     The Inbox opens the grader with `queue`, [{ aid, studentIds }] in the
     order its stacks are shown. On the last step of a piece Next names the
     next piece and carries on into it, in the same dialog; Previous on the
     first step goes back to the last step of the one before. After the
     last piece Next reads Finish and the dialog shows All Caught Up. With
     no queue none of this draws and nothing here runs. */
  function _graderQueueOf(queue, aid) {
    if (!queue || !queue.length) return null;
    var out = queue
      .filter(function (q) {
        return q && q.aid;
      })
      .map(function (q) {
        return { aid: q.aid, studentIds: (q.studentIds || []).slice() };
      });
    return out.some(function (q) {
      return q.aid === aid;
    })
      ? out
      : null;
  }

  // A piece the queue can carry into: it is in the class and has someone in its list.
  function _graderQueueTarget(dir) {
    var cid = pageState.activeCourse;
    var roster = getStudents(cid).map(function (s) {
      return s.id;
    });
    for (var i = pageState._grader.qi + dir; i >= 0 && i < pageState._grader.queue.length; i += dir) {
      var q = pageState._grader.queue[i];
      if (!_assessmentById(cid, q.aid)) continue;
      var anyone = q.studentIds.some(function (id) {
        return roster.indexOf(id) >= 0;
      });
      if (anyone) return i;
    }
    return -1;
  }

  /* True when a step in `dir` has nowhere to go in this piece: the last (or
     first) student, group or one Show lists. */
  function _graderEdge(dir) {
    var cid = pageState.activeCourse;
    var a = _assessmentById(cid, pageState._grader.aid);
    if (!a) return false;
    if (_graderShowOn() && _graderShowWanted(cid, a)) return !_nextShownStop(cid, a, dir);
    var steps = _graderSteps(cid, a);
    if (steps) {
      var u = _graderUnitIndex(steps, pageState.focusStudentId);
      return u >= 0 && (dir > 0 ? u >= steps.length - 1 : u <= 0);
    }
    var i = pageState._grader.studentIds.indexOf(pageState.focusStudentId);
    return i >= 0 && (dir > 0 ? i >= pageState._grader.studentIds.length - 1 : i <= 0);
  }

  // ← → at an edge of a piece in a queue. True when it was used.
  function _graderQueueStep(dir) {
    if (!pageState._grader.queue || !_graderEdge(dir)) return false;
    var to = _graderQueueTarget(dir);
    if (to >= 0) _graderSwitchPiece(to, dir > 0 ? 'first' : 'last');
    else if (dir > 0) _graderShowCaughtUp();
    else return false;
    return true;
  }

  /* The dialog on another piece of the queue, as if it had been opened on
     it: its students, its work pane and Show as they began. The dialog, its
     listeners and onClose stay. `which` is the student it lands on: the
     first one Show lists, or the last. */
  function _graderSwitchPiece(qi, which) {
    var cid = pageState.activeCourse;
    var q = pageState._grader.queue[qi];
    // A field being typed in saves on blur, so finish it first.
    var active = /** @type {any} */ (document.activeElement);
    if (active && pageState._grader.overlay.contains(active) && active.blur) active.blur();
    if (window.MarkUp && MarkUp.isOpen()) MarkUp.close();
    var roster = getStudents(cid).map(function (s) {
      return s.id;
    });
    var ids = q.studentIds.filter(function (id) {
      return roster.indexOf(id) >= 0;
    });
    _graderForgetDrawn();
    pageState._grader.aid = q.aid;
    pageState._grader.qi = qi;
    pageState._grader.studentIds = ids;
    if (pageState._grader.rowOrder) pageState._grader.rowOrder = ids.slice();
    pageState._grader.menuSid = null;
    pageState._grader.show = pageState._grader.queueShow;
    pageState._grader.work = { page: 0, fit: _workFitSaved(), turns: {}, focus: false, pics: {} };
    pageState._grader.reflectDrafts = {};
    pageState._grader.reflectBusy = null;
    pageState._grader.reflectMsg = null;
    pageState._grader.revisionMsg = null;
    pageState._grader.source = null;
    // Drawn from the start, as a piece opened new is.
    pageState._grader.workShell = undefined;
    pageState.openAssessIds = new Set([q.aid]);
    pageState._commentPopoverState = null;
    CritComment.drop();
    pageState._kbFocusEl = null;
    pageState._statusDebounce = {};
    var a = _assessmentById(cid, q.aid);
    var stops = _graderStops(cid, a);
    var listed =
      _graderShowOn() && _graderShowWanted(cid, a)
        ? stops.filter(function (s) {
            return _stopShown(cid, q.aid, s, pageState._grader.show);
          })
        : [];
    var pool = listed.length ? listed : stops;
    var stop = which === 'last' ? pool[pool.length - 1] : pool[0];
    pageState.focusStudentId = stop.focus;
    _graderToTop();
    render();
    if (!pageState._grader) return;
    var again = pageState._grader.overlay.querySelector('[data-grader="next"]:not(:disabled)');
    if (again) again.focus({ preventScroll: true });
    else pageState._grader.overlay.querySelector('.grader-dialog').focus({ preventScroll: true });
    if (which === 'first') _focusGraderPoints(q.aid);
  }

  /* Next and Previous in a queue: on the last step of a piece Next names the
     next piece (or reads Finish after the last); on the first step Previous
     is on when a piece comes before. Called after the dialog's chrome is
     drawn, so it has the last word on both buttons. */
  function _graderApplyQueue(dialog, cid, a, view) {
    if (!pageState._grader.queue) return;
    if (pageState._grader.caughtUp && !dialog.querySelector('.grader-caught-up')) pageState._grader.caughtUp = false;
    var next = dialog.querySelector('[data-grader="next"]');
    var prev = dialog.querySelector('[data-grader="prev"]');
    if (!next || !prev) return;
    if (_graderEdge(1)) {
      var to = _graderQueueTarget(1);
      var following = to >= 0 ? _assessmentById(cid, pageState._grader.queue[to].aid) : null;
      var title = following ? following.title || 'Assessment' : '';
      var label = following ? 'Next: ' + title + ' →' : 'Finish';
      next.disabled = false;
      if (next.dataset.queueLabel !== label) {
        next.dataset.queueLabel = label;
        next.classList.add('is-queue');
        // html-safe: the title goes through esc
        next.innerHTML = following
          ? '<span class="grader-next-pre">Next: </span><span class="grader-next-title">' +
            esc(title) +
            '</span><span class="grader-next-arrow"> →</span>'
          : '<span class="grader-next-pre">Finish</span>';
      }
      next.setAttribute('aria-label', label);
      next.title = label;
    } else if (next.classList.contains('is-queue')) {
      next.classList.remove('is-queue');
      delete next.dataset.queueLabel;
      next.removeAttribute('title');
      // html-safe: a fixed icon
      next.innerHTML = _GRADER_CHEVRON_RIGHT;
      next.setAttribute('aria-label', view ? 'Next' : 'Next student');
    }
    var back = _graderEdge(-1) ? _graderQueueTarget(-1) : -1;
    if (back >= 0) {
      var before = _assessmentById(cid, pageState._grader.queue[back].aid);
      prev.disabled = false;
      prev.title = 'Previous: ' + (before.title || 'Assessment');
      prev.dataset.queueBack = '1';
    } else if (prev.dataset.queueBack) {
      delete prev.dataset.queueBack;
      prev.removeAttribute('title');
    }
  }

  // The queue's pieces with grades waiting, in order: [{ aid, title, sids }], whole class.
  function _graderQueueWaiting(cid) {
    if (!_holdsGrades(cid)) return [];
    var roster = getStudents(cid).map(function (s) {
      return s.id;
    });
    var seen = {};
    var out = [];
    pageState._grader.queue.forEach(function (q) {
      var a = _assessmentById(cid, q.aid);
      if (!a || seen[q.aid]) return;
      seen[q.aid] = true;
      var sids = GraderWork.draftsReturned(cid, q.aid, roster);
      if (sids.length) out.push({ aid: q.aid, title: a.title || 'Assessment', sids: sids });
    });
    return out;
  }

  /* All Caught Up, over the dialog after the last step of the last piece:
     what is waiting to be returned, piece by piece, then Return N Graded
     and Not Yet; in a class that holds no grades, or with nothing waiting,
     Done. */
  // html-safe: counts and fixed words; titles go through esc
  function _graderCaughtUpHtml(items) {
    var n = items.reduce(function (sum, i) {
      return sum + i.sids.length;
    }, 0);
    return (
      '<h2 class="grader-caught-up-title" id="grader-caught-up-title">All Caught Up</h2>' +
      (items.length
        ? '<ul class="grader-caught-up-list">' +
          items
            .map(function (i) {
              return (
                '<li><span class="grader-caught-up-name">' +
                esc(i.title) +
                '</span><span class="grader-caught-up-n">' +
                i.sids.length +
                ' graded</span></li>'
              );
            })
            .join('') +
          '</ul>' +
          '<div class="grader-caught-up-actions">' +
          '<button type="button" class="btn btn-primary" data-grader="caught-return">' +
          esc(GradeState.returnNGraded(n)) +
          '</button>' +
          '<button type="button" class="btn btn-ghost" data-grader="caught-close">Not Yet</button></div>'
        : '<div class="grader-caught-up-actions">' +
          '<button type="button" class="btn btn-primary" data-grader="caught-close">Done</button></div>')
    );
  }

  function _graderShowCaughtUp() {
    var cid = pageState.activeCourse;
    var dialog = pageState._grader.overlay.querySelector('.grader-dialog');
    if (!dialog) return;
    var active = /** @type {any} */ (document.activeElement);
    if (active && pageState._grader.overlay.contains(active) && active.blur) active.blur();
    _graderHideCaughtUp();
    var panel = document.createElement('section');
    panel.className = 'grader-caught-up';
    panel.setAttribute('aria-labelledby', 'grader-caught-up-title');
    // html-safe: built by _graderCaughtUpHtml
    panel.innerHTML = _graderCaughtUpHtml(_graderQueueWaiting(cid));
    Array.prototype.forEach.call(dialog.children, function (el) {
      el.setAttribute('inert', '');
    });
    dialog.appendChild(panel);
    pageState._grader.caughtUp = true;
    var first = panel.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }

  function _graderHideCaughtUp() {
    if (!pageState._grader) return;
    var dialog = pageState._grader.overlay.querySelector('.grader-dialog');
    if (!dialog) return;
    var panel = dialog.querySelector('.grader-caught-up');
    if (panel) panel.remove();
    Array.prototype.forEach.call(dialog.children, function (el) {
      el.removeAttribute('inert');
    });
    var wasUp = pageState._grader.caughtUp;
    pageState._grader.caughtUp = false;
    if (wasUp) {
      var back = dialog.querySelector('[data-grader="next"]') || dialog;
      back.focus({ preventScroll: true });
    }
  }

  // Return N Graded on the panel: asks first, naming everyone, then returns each piece's drafts and closes.
  function _graderCaughtReturn(button) {
    if (!pageState._grader) return;
    var cid = pageState.activeCourse;
    var overlay = pageState._grader.overlay;
    var items = _graderQueueWaiting(cid);
    if (!items.length) return closeGrader();
    _askReturnPieces(cid, items, button, function () {
      if (!pageState._grader || pageState._grader.overlay !== overlay) return;
      items.forEach(function (i) {
        _returnDrafts(cid, i.aid, i.sids);
      });
      closeGrader();
    });
  }

  /* One question for the drafts waiting on several pieces: "Return 4 Grades
     Now?" and the names, once each, of everyone with a grade waiting. */
  function _askReturnPieces(cid, items, button, then) {
    var all = [];
    items.forEach(function (i) {
      all = all.concat(i.sids);
    });
    var who = all.filter(function (sid, k) {
      return all.indexOf(sid) === k;
    });
    var message = GradeState.draftsSentence(cid, who);
    if (who.length !== all.length)
      message = message.replace(/^\d+ drafts?/, all.length + ' drafts').replace(' it yet.', ' them yet.');
    if (button && button.focus) button.focus({ preventScroll: true });
    showConfirm(GradeState.returnQuestion(all.length), message, GradeState.returnNGraded(all.length), 'primary', then);
  }

  /* The Dashboard's Return N Graded (I3): one question naming everyone with
     a grade waiting on these pieces, then each piece's drafts are returned
     and `then` is called. It reads nothing from the page shown: every call
     takes the class. Nothing happens, and `then` is not called, in a class
     that holds no grades or with nothing waiting. */
  function askReturn(cid, aids, button, then) {
    if (!_holdsGrades(cid)) return;
    var roster = getStudents(cid).map(function (s) {
      return s.id;
    });
    var items = [];
    (aids || []).forEach(function (aid) {
      var have = items.some(function (i) {
        return i.aid === aid;
      });
      if (have) return;
      var sids = GraderWork.draftsReturned(cid, aid, roster);
      if (sids.length) items.push({ aid: aid, sids: sids });
    });
    if (!items.length) return;
    _askReturnPieces(cid, items, button, function () {
      items.forEach(function (i) {
        _returnDrafts(cid, i.aid, i.sids);
      });
      if (typeof then === 'function') then();
    });
  }

  // ← → on group work. False on other work, which steps student by student.
  function _graderStepGroup(dir) {
    var cid = pageState.activeCourse;
    var a = _assessmentById(cid, pageState._grader.aid);
    var units = _graderSteps(cid, a);
    if (!units) return false;
    var next = units[_graderUnitIndex(units, pageState.focusStudentId) + dir];
    if (_graderUnitIndex(units, pageState.focusStudentId) < 0 || !next) return true;
    pageState._grader.menuSid = null;
    pageState.focusStudentId = next.source || next.sid;
    render();
    return true;
  }

  // The members card's buttons: the ⋯ menu, Grade Separately, Back to
  // Group Grade and a separated member's name, which opens their view.
  function _graderGroupAction(what, sid) {
    var cid = pageState.activeCourse;
    var aid = pageState._grader.aid;
    var a = _assessmentById(cid, aid);
    if (!a || !sid) return;
    if (what === 'member-menu') {
      pageState._grader.menuSid = pageState._grader.menuSid === sid ? null : sid;
      _refreshGraderChrome();
      var item =
        pageState._grader.menuSid &&
        pageState._grader.overlay.querySelector('.grader-member-menu:not([hidden]) button');
      if (item) item.focus();
    } else if (what === 'separate') {
      pageState._grader.menuSid = null;
      Grader.gradeSeparately(cid, aid, sid);
      // The group stays open; it draws from another member now if it drew
      // from this one.
      if (pageState.focusStudentId === sid) {
        var stillLinked = (getCollabGroupOf(a, sid) || { members: [] }).members.find(function (m) {
          return !isGradedSeparately(a, m);
        });
        var view = stillLinked && _graderGroupView(cid, a, stillLinked);
        if (view) pageState.focusStudentId = view.source;
      }
      refreshSidebarGrades();
      render();
    } else if (what === 'rejoin') {
      _confirmBackToGroupGrade(cid, a, sid);
    } else if (what === 'open-member') {
      pageState._grader.menuSid = null;
      pageState.focusStudentId = sid;
      render();
    } else if (what === 'change-one') {
      // Change One Student (S12-F2): they keep the group's grade as their
      // own from here, and their grader opens to change it.
      pageState._grader.menuSid = null;
      if (!isGradedSeparately(a, sid)) Grader.gradeSeparately(cid, aid, sid);
      pageState.focusStudentId = sid;
      refreshSidebarGrades();
      render();
    }
  }

  function _confirmBackToGroupGrade(cid, a, sid) {
    var st = getStudents(cid).find(function (x) {
      return x.id === sid;
    });
    var group = getCollabGroupOf(a, sid);
    if (!st || !group) return;
    var done = function () {
      Grader.backToGroupGrade(cid, a.id, sid);
      refreshSidebarGrades();
      render();
    };
    // Nobody to copy from: nothing is replaced, so nothing to ask.
    if (!backToGroupGradeSource(cid, a.id, sid)) return done();
    var first = displayNameFirst(st);
    showConfirm(
      'Back to Group Grade?',
      first + '’s own levels, comments and Overall Comment will be replaced by ' + collabGroupLabel(group) + '’s.',
      'Back to Group Grade',
      'primary',
      done,
    );
  }

  /* Students in This Group (S12-F2): what is different for a member
     graded on their own, criterion by criterion, against the group's
     grade ("Roles on the Manor: Emerging · changed for Leo"). Levels are
     named through scoreLevelText. */
  function _memberChanges(cid, a, sid, source) {
    if (!source || source === sid) return [];
    var levelsOf = function (id) {
      var out = {};
      (getScores(cid)[id] || []).forEach(function (e) {
        if (e && e.assessmentId === a.id && e.tagId && e.tagId !== 'overall') out[e.tagId] = e;
      });
      return out;
    };
    var mine = levelsOf(sid);
    var theirs = levelsOf(source);
    var names = {};
    var rubric = a.rubricId ? getRubricById(cid, a.rubricId) : null;
    ((rubric && rubric.criteria) || []).forEach(function (c) {
      rubricCriterionScoreKeys(c).forEach(function (k) {
        names[k] = c.name || c.title || '';
      });
    });
    var first = displayNameFirst(_workStudent(cid, sid) || {});
    var out = [];
    Object.keys(mine).forEach(function (k) {
      var m = mine[k];
      var t = theirs[k];
      if (t && t.score === m.score && (t.mod || 0) === (m.mod || 0)) return;
      var name = names[k] || (getTagById(cid, k) || {}).label || '';
      var level = scoreLevelText(m.score, m.mod);
      if (!name || !level) return;
      out.push(name + ': ' + level + ' · changed for ' + first);
    });
    return out;
  }
  var _COUNT_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six'];

  /* One member as a row of Students in This Group (TGroupGrade): the
     name, "Same as group" (or what was changed for them) at the right,
     their own Missing | Excused | Late, and ⋯ (Grade Separately) or Back
     to Group Grade. */
  // html-safe: names go through esc(); ids are ours; labels are constants
  function _graderMemberHtml(cid, a, st, menuSid, source) {
    var sid = st.id;
    var name = esc(displayNameWithLast(st));
    var status = getAssignmentStatus(cid, sid, a.id);
    var statusHtml =
      '<div class="grader-status" role="group" aria-label="Status for ' +
      name +
      '">' +
      _graderStatusButtons(a.id, sid, status, ['NS', 'EXC', 'LATE']) +
      '</div>';
    if (isGradedSeparately(a, sid)) {
      var grade = _graderGrade(cid, a, sid);
      var changes = _memberChanges(cid, a, sid, source);
      return (
        '<div class="grader-member is-separate">' +
        '<button type="button" class="grader-member-name is-link" data-grader="open-member" data-sid="' +
        sid +
        '">' +
        name +
        '</button>' +
        '<div class="grader-member-separate">Graded Separately<span class="grader-grade' +
        (grade.tone ? ' tone-' + grade.tone : '') +
        '">' +
        esc(grade.text) +
        '</span></div>' +
        statusHtml +
        '<button type="button" class="grader-member-back" data-grader="rejoin" data-sid="' +
        sid +
        '">Back to Group Grade</button>' +
        (changes.length
          ? '<div class="grader-member-changes">' +
            changes
              .map(function (line) {
                return '<p class="grader-member-same is-changed">' + esc(line) + '</p>';
              })
              .join('') +
            '</div>'
          : '') +
        '</div>'
      );
    }
    var open = menuSid === sid;
    return (
      '<div class="grader-member">' +
      '<span class="grader-member-name">' +
      name +
      '</span>' +
      '<p class="grader-member-same">Same as group</p>' +
      statusHtml +
      '<button type="button" class="grader-member-more" data-grader="member-menu" data-sid="' +
      sid +
      '" aria-label="More for ' +
      name +
      '" aria-haspopup="menu" aria-expanded="' +
      open +
      '">' +
      _GRADER_MORE_ICON +
      '</button>' +
      '<div class="grader-member-menu" role="menu"' +
      (open ? '' : ' hidden') +
      '><button type="button" role="menuitem" data-grader="separate" data-sid="' +
      sid +
      '">Grade Separately</button></div>' +
      '</div>'
    );
  }

  /* Students in This Group sits after the criteria and before the Overall
     Comment, as on the board; with no group it goes back above the
     scoring, where _drawGraderPanel keeps it while the scoring is redrawn. */
  function _placeGroupMembers(panel, card, inGroup) {
    var body = panel.querySelector('.grader-body');
    if (!body) return;
    var overall = inGroup ? body.querySelector('.grdt-overall') : null;
    if (overall) {
      if (card.nextElementSibling !== overall) overall.parentNode.insertBefore(card, overall);
    } else if (inGroup) {
      if (card.previousElementSibling !== body) body.parentNode.insertBefore(card, body.nextSibling);
    } else if (card.nextElementSibling !== body) {
      body.parentNode.insertBefore(card, body);
    }
  }

  // The members card (group view) and the Graded Separately From line (a
  // member graded separately), redrawn only when they change.
  function _refreshGroupChrome(dialog, cid, a, sid, view) {
    var card = dialog.querySelector('.grader-members');
    var html = '';
    if (view) {
      var byId = {};
      getStudents(cid).forEach(function (s) {
        byId[s.id] = s;
      });
      var n = view.members.length;
      // The board's Students in This Group (TGroupGrade), with or without
      // the work beside the scoring: one grade for all, and Change One
      // Student (Grade Separately, then open them).
      html =
        '<h2 class="grader-members-title" id="grader-members-title">' +
        (view.group.kind === 'pair' ? 'Students in This Pair' : 'Students in This Group') +
        '</h2>' +
        '<p class="grader-members-hint">' +
        esc(
          (n === 2 ? 'One grade for both' : 'One grade for all ' + (_COUNT_WORDS[n] || n)) +
            '. Change one student only when their part was different.',
        ) +
        '</p>' +
        '<div class="grader-members-grid">' +
        view.members
          .map(function (m) {
            return _graderMemberHtml(cid, a, byId[m], pageState._grader.menuSid, view.source);
          })
          .join('') +
        '</div>';
      var changeable = view.linked.filter(function (m) {
        return byId[m];
      });
      var openChange = pageState._grader.menuSid === 'change-one';
      html +=
        '<div class="grader-change-one">' +
        '<button type="button" class="grader-change-one-btn" data-grader="member-menu" data-sid="change-one" aria-haspopup="menu" aria-expanded="' +
        openChange +
        '"' +
        (changeable.length > 1 ? '' : ' disabled') +
        '>Change One Student</button>' +
        '<div class="grader-member-menu" role="menu"' +
        (openChange ? '' : ' hidden') +
        '>' +
        changeable
          .map(function (m) {
            return (
              '<button type="button" role="menuitem" data-grader="change-one" data-sid="' +
              m +
              '">' +
              esc(displayNameWithLast(byId[m])) +
              '</button>'
            );
          })
          .join('') +
        '</div></div>';
    }
    if (pageState._grader.membersHtml !== html) {
      // html-safe: built by _graderMemberHtml, names escaped there
      card.innerHTML = html;
      pageState._grader.membersHtml = html;
    }
    card.hidden = !view;
    _placeGroupMembers(dialog, card, !!view);
    var line = dialog.querySelector('.grader-separate-line');
    var group = !view && isGradedSeparately(a, sid) ? getCollabGroupOf(a, sid) : null;
    var lineHtml = group
      ? esc('Graded Separately From ' + collabGroupLabel(group)) +
        '<button type="button" class="grader-member-back" data-grader="rejoin" data-sid="' +
        sid +
        '">Back to Group Grade</button>'
      : '';
    if (pageState._grader.lineHtml !== lineHtml) {
      // html-safe: the label goes through esc(); sid is our id
      line.innerHTML = lineHtml;
      pageState._grader.lineHtml = lineHtml;
    }
    line.hidden = !group;
  }

  /* The parts of the dialog that change with every click: the status
     control, the Note for the Report and the grade. */
  /* The same buttons with new states are updated where they are: a score
     typed and then Late clicked locks Missing and Excused as the box loses
     focus, mid-click, and a Late button swapped in then can lose the click.
     False when the buttons themselves differ. */
  function _patchStatusButtons(box, html) {
    var tpl = document.createElement('template');
    // html-safe: html is built by _graderStatusButtons
    tpl.innerHTML = html;
    var fresh = tpl.content.querySelectorAll('.grader-status-btn');
    var now = box.querySelectorAll('.grader-status-btn');
    if (!now.length || fresh.length !== now.length) return false;
    for (var i = 0; i < now.length; i++) {
      if (
        now[i].dataset.status !== /** @type {any} */ (fresh[i]).dataset.status ||
        now[i].dataset.sid !== /** @type {any} */ (fresh[i]).dataset.sid ||
        now[i].dataset.aid !== /** @type {any} */ (fresh[i]).dataset.aid
      )
        return false;
    }
    now.forEach(function (btn, j) {
      var f = /** @type {any} */ (fresh[j]);
      btn.className = f.className;
      btn.setAttribute('aria-pressed', f.getAttribute('aria-pressed'));
      btn.disabled = f.disabled;
      if (f.hasAttribute('title')) btn.title = f.title;
      else btn.removeAttribute('title');
    });
    return true;
  }
  function _refreshGraderChrome() {
    if (!pageState._grader) return;
    var cid = pageState.activeCourse;
    var sid = pageState.focusStudentId;
    var a = getAssessments(cid).find(function (x) {
      return x.id === pageState._grader.aid;
    });
    var dialog = pageState._grader.overlay.querySelector('.grader-dialog');
    if (!a || !sid || !dialog) return;
    var view = _graderGroupView(cid, a, sid);
    // The member the group's grade comes from changed (Missing, Excused or
    // Grade Separately): draw the group again from the new one.
    if ((view ? view.source : null) !== (pageState._grader.source || null)) return render();
    _refreshGraderPanel(_graderPart(dialog, 'panel'), cid, a, sid, view);
    _refreshGraderHead(_graderPart(dialog, 'head'), cid, a, sid, view);
    var foot = _graderPart(dialog, 'foot');
    // Points work's box takes Return to the next student, so the hint says
    // so; ← → step while nothing new is typed in it (_graderCardKey).
    var returnStep = isPointsScored(a) && !isCompletionScored(a) ? 'Return next student \u00B7 ' : '';
    foot.querySelector('.grader-hint').textContent = view
      ? returnStep + '\u2190 \u2192 change group \u00B7 Esc closes'
      : returnStep + '\u2190 \u2192 change student \u00B7 Esc closes';
    _refreshGraderReturn(dialog, cid, a, sid, view);
    // A revision's card and its "Was …" lines (S11-F3), on one student's own piece.
    var own = view ? null : _workStudent(cid, sid);
    if (own) _refreshGraderRevision(dialog, cid, a, own);
    _refreshGraderWas(dialog, cid, a, own ? sid : null);
    if (pageState._grader.workShell) {
      _refreshGraderWorkLine(dialog, cid, a, sid);
      _graderShortLevels(dialog);
    }
    // To Return, Returned and All, and Return N Graded (S1-F2). It draws
    // the dialog again itself when what Show lists has run out.
    if (_refreshGraderShow(dialog, cid, a)) return;
    _graderApplyQueue(dialog, cid, a, view);
    var grade = _graderGrade(cid, a, sid);
    // The foot's: a member graded separately has a grade of her own in the
    // members card, above it.
    var pill = foot.querySelector('.grader-grade');
    pill.textContent = grade.text;
    pill.className = 'grader-grade' + (grade.tone ? ' tone-' + grade.tone : '');
    // A DIBELS benchmark has no grade: its footer shows the ORF and Maze levels.
    var dibels = isDibelsScored(a);
    foot.querySelector('.grader-grade-label').hidden = dibels;
    pill.hidden = dibels;
    var levels = foot.querySelector('.grader-dibels-levels');
    if (dibels) {
      if (!levels) {
        levels = document.createElement('span');
        levels.className = 'grader-dibels-levels';
        foot.appendChild(levels);
      }
      levels.innerHTML = _dibelsLevelPillsHtml(cid, a, sid);
    } else if (levels) levels.remove();
  }

  return {
    configure: configure,
    _GRADER_MORE_ICON: _GRADER_MORE_ICON,
    _NOT_SCORED_ICON: _NOT_SCORED_ICON,
    _afterGradingEvent: _afterGradingEvent,
    _confirmBackToGroupGrade: _confirmBackToGroupGrade,
    _drawGraderHead: _drawGraderHead,
    _drawGraderPanel: _drawGraderPanel,
    _drawGraderToolbar: _drawGraderToolbar,
    _graderCaughtReturn: _graderCaughtReturn,
    _graderFootHtml: _graderFootHtml,
    _graderGroupAction: _graderGroupAction,
    _graderGroupView: _graderGroupView,
    _graderHeadHtml: _graderHeadHtml,
    _graderHideCaughtUp: _graderHideCaughtUp,
    _graderPanelHtml: _graderPanelHtml,
    _graderPart: _graderPart,
    _graderQueueOf: _graderQueueOf,
    _graderQueueStep: _graderQueueStep,
    _graderShellHtml: _graderShellHtml,
    _graderStatusButtons: _graderStatusButtons,
    _graderStepGroup: _graderStepGroup,
    _graderSteps: _graderSteps,
    _graderToolbarHtml: _graderToolbarHtml,
    _graderUnits: _graderUnits,
    _gradingScope: _gradingScope,
    _inlineGraderHtml: _inlineGraderHtml,
    _refreshGraderChrome: _refreshGraderChrome,
    _statusLockAttrs: _statusLockAttrs,
    _syncStatusLocks: _syncStatusLocks,
    _unitIds: _unitIds,
    askReturn: askReturn,
  };
})();
