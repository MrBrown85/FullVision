// @ts-check
/* assign-focus.js — Assignments: the student in focus. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignFocus = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var pageState,
    render,
    _graderAid,
    _graderHideCaughtUp,
    _graderQueueStep,
    _graderRoot,
    _graderStepGroup,
    _graderStepShown,
    kbFocusCell;
  function configure(h) {
    if ('pageState' in h) pageState = h.pageState;
    if ('render' in h) render = h.render;
    if ('_graderAid' in h) _graderAid = h._graderAid;
    if ('_graderHideCaughtUp' in h) _graderHideCaughtUp = h._graderHideCaughtUp;
    if ('_graderQueueStep' in h) _graderQueueStep = h._graderQueueStep;
    if ('_graderRoot' in h) _graderRoot = h._graderRoot;
    if ('_graderStepGroup' in h) _graderStepGroup = h._graderStepGroup;
    if ('_graderStepShown' in h) _graderStepShown = h._graderStepShown;
    if ('kbFocusCell' in h) kbFocusCell = h.kbFocusCell;
  }

  /* ── Focus Student ─────────────────────────────────────── */
  /* Picking a student while some assessments are open (grading the whole
     class) keeps just those open, for that student; with none open, every
     assessment opens. Leaving keeps the class on those same assessments. */
  function toggleFocusStudent(sid) {
    if (pageState.focusStudentId === sid) {
      _leaveFocus();
    } else if (!pageState.focusStudentId) {
      pageState.focusStudentId = sid;
      pageState._collapsedIds.clear();
      pageState._allExpanded = pageState.openAssessIds.size === 0;
    } else {
      pageState.focusStudentId = sid;
    }
    _syncSidebarSelection();
    render();
    // One points card open: its box is ready to type in.
    var boxes = pageState.focusStudentId ? document.querySelectorAll('.assess-card.open .grdp-input') : [];
    if (boxes.length === 1) _focusGraderPoints(_graderAid(boxes[0]));
  }

  function clearFocusStudent() {
    _leaveFocus();
    _syncSidebarSelection();
    render();
  }

  function _leaveFocus() {
    pageState.focusStudentId = null;
    if (pageState._allExpanded) pageState.openAssessIds.clear();
    pageState._allExpanded = true;
    pageState._collapsedIds.clear();
  }

  /* Mark the focused student in the roster without redrawing it, so the
     names and the roster's scroll stay put. */
  function _syncSidebarSelection() {
    if (pageState._grader) return;
    var rows = document.querySelectorAll('#gb-roster-list .student-row');
    if (!rows.length) {
      SidebarKeep.draw(renderSidebar(pageState.activeCourse, pageState.focusStudentId, 'toggleFocusStudent'));
      return;
    }
    var picked = /** @type {any} */ (null);
    rows.forEach(function (r) {
      var on = /** @type {any} */ (r).dataset.sid === pageState.focusStudentId;
      r.classList.toggle('selected', on);
      if (on) picked = r;
    });
    _scrollIntoViewIfNeeded(picked, { block: 'nearest' });
  }

  /* Scrolls `el` into view only when part of it is out of sight: out of
     the window, or of a box around it that scrolls. scrollIntoView lays the
     page out and walks every scrolling box around it, for an element
     already in view too. With `soon`, after this frame's own layout (a
     click's writes first): the page is laid out once, not twice. */
  function _scrollIntoViewIfNeeded(el, opts, soon) {
    if (soon) {
      return requestAnimationFrame(function () {
        _scrollIntoViewIfNeeded(el, opts);
      });
    }
    if (!el || !el.scrollIntoView || !el.isConnected) return;
    var w = window.innerWidth;
    var h = window.innerHeight;
    var r = el.getBoundingClientRect && w && h ? el.getBoundingClientRect() : null;
    var out = !r || r.top < 0 || r.left < 0 || r.bottom > h || r.right > w;
    for (var p = el.parentElement; !out && p && p !== document.body; p = p.parentElement) {
      var cs = getComputedStyle(p);
      if (!/auto|scroll|hidden|clip/.test(cs.overflowX + ' ' + cs.overflowY)) continue;
      var b = p.getBoundingClientRect();
      out = r.top < b.top || r.left < b.left || r.bottom > b.bottom || r.right > b.right;
    }
    if (out) el.scrollIntoView(opts);
  }

  /* Left and Right arrows while grading one student: the previous or next
     student in the roster (as filtered by its search), on the same open
     assessments. A focused rubric row moves to the new student's first row. */
  function stepFocusStudent(dir) {
    if (!pageState.focusStudentId) return;
    // The All Caught Up panel (I3): Previous takes it away; nothing else steps.
    if (pageState._grader && pageState._grader.caughtUp) {
      if (dir < 0) _graderHideCaughtUp();
      return;
    }
    var memo = _graderFocusMemo();
    _finishField();
    // With a queue (I3), a step past either end of this piece carries into the next or previous piece.
    if (pageState._grader && _graderQueueStep(dir)) return;
    // Show is on To Return or Returned: the next student it lists (S1-F2).
    if (pageState._grader && _graderStepShown(dir)) {
      _graderToTop();
      _restoreGraderFocus(memo);
      return;
    }
    if (pageState._grader && _graderStepGroup(dir)) {
      _graderToTop();
      _restoreGraderFocus(memo);
      return;
    }
    var ids = pageState._grader
      ? pageState._grader.studentIds
      : Array.prototype.filter
          .call(document.querySelectorAll('#gb-roster-list .student-row'), function (r) {
            return r.style.display !== 'none';
          })
          .map(function (r) {
            return r.dataset.sid;
          });
    if (!ids.length) {
      ids = sortStudents(getStudents(pageState.activeCourse), 'lastName').map(function (s) {
        return s.id;
      });
    }
    var i = ids.indexOf(pageState.focusStudentId);
    var next = ids[i + dir];
    if (i < 0 || !next) return;
    var hadKbFocus = !!pageState._kbFocusEl;
    pageState.focusStudentId = next;
    _syncSidebarSelection();
    render();
    var card = document.querySelector('.assess-card.open');
    if (pageState._grader) _graderToTop();
    else _scrollIntoViewIfNeeded(card, { block: 'nearest' }, true);
    if (hadKbFocus && card) kbFocusCell(card.querySelector('.rsg-criterion-row'));
    else _restoreGraderFocus(memo);
  }

  /* A box being typed in saves when the teacher leaves it. A step leaves it first, while its student is
     still the one on the page, so what is in it is saved for them and not lost with the redraw. */
  function _finishField() {
    var el = /** @type {any} */ (document.activeElement);
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.blur) el.blur();
  }

  /* The grader opens the next student at the top, under their name: kept
     scrolled down, the name was off screen and a teacher could score the
     wrong student (Nov 3 sweep). The same card keeps the focus. */
  function _graderToTop() {
    var sc = pageState._grader && pageState._grader.overlay.querySelector('.grader-scroll');
    if (sc) {
      sc.scrollTop = 0;
      // The next student comes in with a short fade. A script-driven fade
      // leaves no class or attribute behind in the page's markup.
      if (
        sc.animate &&
        /** @type {any} */ (window).matchMedia &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        sc.animate([{ opacity: 0.45 }, { opacity: 1 }], { duration: 150, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
      }
    }
  }

  /* The grading control that has focus (a criterion or competency card, a
     points box), so the next student's view can focus the same one. */
  function _graderFocusMemo() {
    var el = /** @type {any} */ (document.activeElement);
    var cls = el && el.classList;
    if (!cls) return null;
    var aid = _graderAid(el);
    if (!aid) return null;
    if (cls.contains('grdt-crit')) return { aid: aid, sel: '.grdt-crit[data-critid="' + el.dataset.critid + '"]' };
    if (cls.contains('grdl-card')) return { aid: aid, sel: '.grdl-card[data-tag="' + el.dataset.tag + '"]' };
    if (cls.contains('grdp-input')) return { aid: aid, points: true };
    return null;
  }
  // Focus the same control for the new student. In the dialog, points work
  // focuses the box even when the step came from a button.
  function _restoreGraderFocus(memo) {
    if (memo && memo.points) return _focusGraderPoints(memo.aid);
    if (memo) {
      var root = _graderRoot(memo.aid);
      var el = root && root.querySelector(memo.sel);
      if (el) el.focus({ preventScroll: true });
      return;
    }
    if (pageState._grader) _focusGraderPoints(pageState._grader.aid);
  }
  // The student's points box for `aid`, focused with its text selected.
  function _focusGraderPoints(aid) {
    var root = aid && _graderRoot(aid);
    var box = root && root.querySelector('.grdp-input');
    if (!box || box.disabled) return;
    box.focus({ preventScroll: true });
    box.select();
  }

  return {
    configure: configure,
    _focusGraderPoints: _focusGraderPoints,
    _graderToTop: _graderToTop,
    _scrollIntoViewIfNeeded: _scrollIntoViewIfNeeded,
    clearFocusStudent: clearFocusStudent,
    stepFocusStudent: stepFocusStudent,
    toggleFocusStudent: toggleFocusStudent,
  };
})();
