// @ts-check
/* assign-card-open.js — Assignments: opening and closing cards, and the keyboard on cells. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignCardOpen = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var _afterCardsDrawn,
    _hideAfTip,
    _hideChipTip,
    _scrollIntoViewIfNeeded,
    _toolbarState,
    pageState,
    render,
    _cardBodyHtml,
    _cardOpen,
    _refreshCardCounts;
  function configure(h) {
    if ('_afterCardsDrawn' in h) _afterCardsDrawn = h._afterCardsDrawn;
    if ('_hideAfTip' in h) _hideAfTip = h._hideAfTip;
    if ('_hideChipTip' in h) _hideChipTip = h._hideChipTip;
    if ('_scrollIntoViewIfNeeded' in h) _scrollIntoViewIfNeeded = h._scrollIntoViewIfNeeded;
    if ('_toolbarState' in h) _toolbarState = h._toolbarState;
    if ('pageState' in h) pageState = h.pageState;
    if ('render' in h) render = h.render;
    if ('_cardBodyHtml' in h) _cardBodyHtml = h._cardBodyHtml;
    if ('_cardOpen' in h) _cardOpen = h._cardOpen;
    if ('_refreshCardCounts' in h) _refreshCardCounts = h._refreshCardCounts;
  }

  /* ── Expand/Collapse ────────────────────────────────────── */
  // Whether Expand and Collapse show pressed.
  function _expandSegOn() {
    return pageState.focusStudentId
      ? [
          pageState._allExpanded && pageState._collapsedIds.size === 0,
          !pageState._allExpanded && pageState.openAssessIds.size === 0,
        ]
      : [
          pageState.openAssessIds.size > 0 &&
            pageState.openAssessIds.size >= getAssessments(pageState.activeCourse).length,
          pageState.openAssessIds.size === 0,
        ];
  }

  /* Opening or closing cards draws or empties those cards' bodies and sets
     Expand and Collapse; the rest of the page stays as drawn (a whole
     redraw took 260 ms of script). False when the page must be drawn
     again instead: a card not on the page, or a folder the teacher closed
     that must now open or close. */
  function _redrawCards(aids) {
    var cid = pageState.activeCourse;
    var main = document.getElementById('main');
    if (pageState._grader || !main || !COURSES[cid]) return false;
    // A filter on grades (Ungraded, To Return) can drop a card graded since the draw.
    if (pageState.showUngraded || pageState._toReturnOnly) return false;
    var opensFolders = pageState.filterCategories.length > 0 || !!pageState.assessSearch;
    var all = getAssessments(cid);
    var byId = {};
    all.forEach(function (a) {
      byId[a.id] = a;
    });
    var cards = [];
    for (var i = 0; i < aids.length; i++) {
      var card = document.getElementById('ac-' + aids[i]);
      var a = card && main.contains(card) && byId[aids[i]];
      if (!a) return false;
      cards.push({ card: card, a: a });
    }
    // A folder the teacher closed is drawn open only while a card in it is
    // held open (renderAssessmentList): every folder is checked, since Expand
    // lets go of cards that stay open.
    var folders = opensFolders ? [] : main.querySelectorAll('.mod-folder');
    for (var f = 0; f < folders.length; f++) {
      if (!pageState.collapsedModules[/** @type {any} */ (folders[f]).dataset.moduleId]) continue;
      var holds = Array.prototype.some.call(folders[f].querySelectorAll('.assess-card'), function (el) {
        return pageState.openAssessIds.has(el.id.slice(3));
      });
      if (holds !== folders[f].classList.contains('open')) return false;
    }
    _hideChipTip();
    _hideAfTip();
    if (typeof refreshStudentWork === 'function') refreshStudentWork(cid);
    var students = sortStudents(getStudents(cid), 'lastName');
    var scores = getScores(cid);
    _refreshCardCounts(
      cid,
      byId,
      students,
      pageState.focusStudentId
        ? [pageState.focusStudentId]
        : students.map(function (st) {
            return st.id;
          }),
    );
    var focusSt = pageState.focusStudentId
      ? students.find(function (st) {
          return st.id === pageState.focusStudentId;
        })
      : null;
    // One card opened or closed moves (teacher/expand-motion.js); Expand
    // and Collapse, which change many, do not.
    var motion = cards.length === 1 ? window.ExpandMotion : null;
    cards.forEach(function (c) {
      var open = _cardOpen(c.a.id);
      var body = c.card.querySelector('.assess-body');
      var wasOpen = c.card.classList.contains('open');
      if (motion) motion.settle(c.card, body, 'is-closing');
      c.card.className = 'assess-card' + (open ? ' open active' : '');
      if (motion && wasOpen && !open && body.firstChild) {
        // It folds away first; its content goes when it has, unless it opened again.
        motion.close(c.card, body, 'is-closing', function () {
          if (c.card.classList.contains('open')) return;
          body.innerHTML = '';
          _afterCardsDrawn(body);
        });
        return;
      }
      pageState._drawnReturns = {};
      // html-safe: _cardBodyHtml escapes the description; the grading builders are reviewed
      body.innerHTML = open ? _cardBodyHtml(cid, c.a, focusSt, students, scores) : '';
      _afterCardsDrawn(body);
      if (motion && open && !wasOpen) motion.open(body);
    });
    AssignToolbar.syncMore(_toolbarState(cid));
    return true;
  }

  function toggleAssess(aid) {
    if (pageState.focusStudentId) {
      if (pageState._allExpanded) {
        if (pageState._collapsedIds.has(aid)) pageState._collapsedIds.delete(aid);
        else pageState._collapsedIds.add(aid);
      } else {
        if (pageState.openAssessIds.has(aid)) pageState.openAssessIds.delete(aid);
        else pageState.openAssessIds.add(aid);
      }
    } else {
      if (pageState.openAssessIds.has(aid)) pageState.openAssessIds.delete(aid);
      else pageState.openAssessIds.add(aid);
    }
    if (!_redrawCards([aid])) render();
  }
  // Expand and Collapse draw or empty only the cards that change.
  function _setAllOpen(change) {
    var was = _cardsOnPage().filter(_cardOpen);
    change();
    var now = _cardsOnPage();
    var changed = now.filter(function (aid) {
      var wasOpen = was.indexOf(aid) >= 0;
      return _cardOpen(aid) !== wasOpen;
    });
    if (!_redrawCards(changed)) render();
  }
  function _cardsOnPage() {
    return Array.prototype.map.call(document.querySelectorAll('#main .assess-card'), function (el) {
      return el.id.slice(3);
    });
  }
  function expandAllAssess() {
    _setAllOpen(function () {
      pageState._allExpanded = true;
      pageState._collapsedIds.clear();
      pageState.openAssessIds.clear();
      if (!pageState.focusStudentId)
        getAssessments(pageState.activeCourse).forEach(function (a) {
          pageState.openAssessIds.add(a.id);
        });
    });
  }
  function collapseAllAssess() {
    _setAllOpen(function () {
      pageState._allExpanded = false;
      pageState._collapsedIds.clear();
      pageState.openAssessIds.clear();
    });
  }

  /* ── Rubric view toggle ─────────────────────────────────── */
  function setRubricView(aid, isRubric) {
    pageState.rubricViewStates[aid] = isRubric;
    render();
  }

  /* ── Export / Import ────────────────────────────────────── */
  /* ── Keyboard Navigation ────────────────────────────────── */
  // A level click ran scrollIntoView straight after its writes (49 ms of
  // layout); the row is now scrolled to, when out of sight, after the frame's.
  function kbFocusCell(el) {
    if (pageState._kbFocusEl) pageState._kbFocusEl.classList.remove('kb-focus');
    pageState._kbFocusEl = el;
    if (el) {
      el.classList.add('kb-focus');
      _scrollIntoViewIfNeeded(el, { block: 'nearest' }, true);
    }
  }
  function navigateKb(direction) {
    if (!pageState._kbFocusEl) return;
    if (pageState._kbFocusEl.classList.contains('rsg-criterion-row')) {
      var grid = pageState._kbFocusEl.closest('.rsg-grid');
      if (!grid) return;
      var allCritRows = Array.from(grid.querySelectorAll('.rsg-criterion-row'));
      var curIdx = allCritRows.indexOf(pageState._kbFocusEl);
      if (curIdx < 0) return;
      var newIdx = curIdx;
      if (direction === 'up' || direction === 'left') newIdx = Math.max(0, curIdx - 1);
      else if (direction === 'down' || direction === 'right') newIdx = Math.min(allCritRows.length - 1, curIdx + 1);
      if (allCritRows[newIdx]) kbFocusCell(allCritRows[newIdx]);
    }
  }

  return {
    configure: configure,
    _expandSegOn: _expandSegOn,
    collapseAllAssess: collapseAllAssess,
    expandAllAssess: expandAllAssess,
    kbFocusCell: kbFocusCell,
    navigateKb: navigateKb,
    setRubricView: setRubricView,
    toggleAssess: toggleAssess,
  };
})();
