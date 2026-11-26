// @ts-check
/* assign-cards.js — Assignments: card filters, icons, the toolbar and the single-point rubric. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignCards = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var _NOT_SCORED_ICON, _criterionState, _quizOn, pageState, render, _expandSegOn, _graderPickHtml, _holdsGrades;
  function configure(h) {
    if ('_NOT_SCORED_ICON' in h) _NOT_SCORED_ICON = h._NOT_SCORED_ICON;
    if ('_criterionState' in h) _criterionState = h._criterionState;
    if ('_quizOn' in h) _quizOn = h._quizOn;
    if ('pageState' in h) pageState = h.pageState;
    if ('render' in h) render = h.render;
    if ('_expandSegOn' in h) _expandSegOn = h._expandSegOn;
    if ('_graderPickHtml' in h) _graderPickHtml = h._graderPickHtml;
    if ('_holdsGrades' in h) _holdsGrades = h._holdsGrades;
  }

  /* ── Assessment Filters ────────────────────────────────── */
  function toggleCategoryFilter(catId) {
    var idx = pageState.filterCategories.indexOf(catId);
    if (idx >= 0) pageState.filterCategories.splice(idx, 1);
    else pageState.filterCategories.push(catId);
    render();
  }

  /* The Assignments list order. A teacher's drag sets display_order 1..n;
     anything never placed (0, e.g. a new assessment) sits on top, newest first. */
  function sortAssessmentsForList(arr) {
    return arr.slice().sort(function (a, b) {
      var oa = Number(a.display_order || 0);
      var ob = Number(b.display_order || 0);
      if (oa !== ob) return oa - ob;
      return (b.date || '').localeCompare(a.date || '');
    });
  }

  function _getSortedCategories(cid) {
    return (getCategories(cid) || []).slice().sort(function (a, b) {
      var orderA = Number(a.displayOrder || 0);
      var orderB = Number(b.displayOrder || 0);
      if (orderA !== orderB) return orderA - orderB;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  function _getAssessmentCategoryId(assessment) {
    return (assessment && (assessment.categoryId || assessment.category_id)) || '';
  }

  function _getCategoryName(cid, categoryId) {
    if (!categoryId) return 'No Category';
    var category = getCategoryById(cid, categoryId);
    return category && category.name ? category.name : 'Unknown Category';
  }

  function setAssessSearch(val) {
    pageState.assessSearch = (val || '').trim();
    clearTimeout(pageState._searchTimer);
    pageState._searchTimer = setTimeout(function () {
      render();
      var inp = /** @type {any} */ (document.querySelector('.assess-search-input'));
      if (inp) {
        inp.focus();
        inp.setSelectionRange(inp.value.length, inp.value.length);
      }
    }, 200);
  }

  /* ── Assessment card icons ─────────────────────────────── */
  var _RUBRIC_ICON =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 19V5"/></svg>';
  var _WARNING_ICON =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17v.5"/></svg>';
  // Points right when closed; the open card turns it down.
  var _CHEVRON_ICON =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

  var _MODULE_CHEVRON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
  var _MODULE_TRASH =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>';

  /* ── Toolbar ────────────────────────────────────────────── */
  // What the toolbar (assign-toolbar.js) draws, from the page's own state.
  function _toolbarState(cid) {
    var all = getAssessments(cid);
    var open = _expandSegOn();
    var targets = window.AssessmentCopy ? AssessmentCopy.copyTargets(cid) : null;
    return {
      cid: cid,
      courses: getPickerCourses(cid),
      search: pageState.assessSearch,
      cats: _getSortedCategories(cid).map(function (cat, i) {
        var t = typeof categoryTintByIndex === 'function' ? categoryTintByIndex(i, cat.name) : { fg: '' };
        return { id: cat.id, name: cat.name, color: t.fg, on: pageState.filterCategories.indexOf(cat.id) >= 0 };
      }),
      ungraded: pageState.showUngraded,
      toReturn: _returnState(cid),
      bulk: AssignList.on(),
      focusStudent: !!pageState.focusStudentId,
      cards: all.length,
      allOpen: open[0],
      noneOpen: open[1],
      quiz: _quizOn(cid),
      copy: !!targets && !!(targets.sameCourse.length || targets.other.length),
    };
  }
  function _returnState(cid) {
    return { holds: _holdsGrades(cid), total: pageState._toReturnTotal, pressed: pageState._toReturnOnly };
  }
  function renderAssessToolbar(cid) {
    var toolbarHtml = AssignToolbar.html(
      _toolbarState(cid),
      window.AssessmentCopy ? AssessmentCopy.renderSiblingToggle(cid) : '',
    );

    // Focus banner when grading a single student
    if (pageState.focusStudentId) {
      var focusSt = getStudents(cid).find(function (s) {
        return s.id === pageState.focusStudentId;
      });
      if (focusSt) {
        toolbarHtml +=
          '<div class="focus-banner">' +
          '<span class="focus-banner-label">Grading: <strong>' +
          esc(focusSt.firstName) +
          ' ' +
          esc(focusSt.lastName) +
          '</strong></span>' +
          '</div>';
      }
    }

    return { toolbarHtml: toolbarHtml };
  }

  /* ── Single-point rubric: one student ──────────────────────
     Each criterion is a card in three columns: Work On (the criterion's
     comment), the Proficient standard with the level control and − | +
     under it, and Went Beyond. Both notes are optional and save when they
     lose focus; 1–4 and + / − work on a focused card. */
  function _rubricCodesHtml(cid, crit) {
    return (crit.tagIds || [])
      .map(function (tid) {
        var t = getTagById(cid, tid);
        if (!t) return '';
        // The printed rubric's rule: the tag's code, else an id that isn't a database id.
        var code = t.code || (t.id && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(t.id) ? t.id : '') || t.label || '';
        return '<span class="grdt-code" title="' + esc(t.label || '') + '">' + esc(code) + '</span>';
      })
      .join('');
  }
  // Ids carry the assessment: one student's view can show several cards
  // on the same rubric.
  function _singlePointNoteHtml(kind, aid, crit, text) {
    var work = kind === 'work';
    var id = (work ? 'grsp-work-' : 'grsp-beyond-') + aid + '-' + crit.id;
    return (
      '<div class="grsp-note ' +
      (work ? 'is-work' : 'is-beyond') +
      '"><label class="grsp-note-label" for="' +
      id +
      '"><span class="grsp-dot" aria-hidden="true"></span>' +
      (work ? 'Work On' : 'Went Beyond') +
      '</label><textarea id="' +
      id +
      '" class="grdt-note' +
      (text ? ' has-text' : '') +
      '" rows="1" data-action-blur="' +
      (work ? 'graderCritNote' : 'graderCritBeyond') +
      '" data-critid="' +
      crit.id +
      '">' +
      esc(text) +
      '</textarea></div>'
    );
  }
  function _singlePointHtml(cid, a, rubric, st) {
    var order = levelOrderFor(cid);
    var html =
      '<div class="grsp-legend">' +
      '<span class="is-work"><span class="grsp-dot" aria-hidden="true"></span>Work On</span>' +
      '<span class="is-standard"><span class="grsp-dot" aria-hidden="true"></span>Proficient Standard</span>' +
      '<span class="is-beyond"><span class="grsp-dot" aria-hidden="true"></span>Went Beyond</span>' +
      '</div>';
    (rubric.criteria || []).forEach(function (crit) {
      if (!crit) return;
      var state = _criterionState(cid, st.id, a.id, crit);
      var seg = order
        .map(function (lv) {
          var on = state.level === lv;
          var btn =
            '<button type="button" class="grdl-level' +
            (on ? ' is-on l' + lv : '') +
            '" data-action="graderLevel" data-critid="' +
            crit.id +
            '" data-level="' +
            lv +
            '" aria-pressed="' +
            on +
            '">' +
            PROF_LABELS[lv] +
            '</button>';
          return on
            ? _graderPickHtml(btn, lv, state.level, state.mod, 'data-action="graderMod" data-critid="' + crit.id + '"')
            : btn;
        })
        .join('');
      var codes = _rubricCodesHtml(cid, crit);
      html +=
        '<section class="grdt-crit grsp-crit" tabindex="0" data-critid="' +
        crit.id +
        '" aria-label="' +
        esc(crit.name || '') +
        '">' +
        _singlePointNoteHtml('work', a.id, crit, getRubricCriterionComment(cid, st.id, a.id, crit)) +
        '<div class="grsp-standard">' +
        '<h3 class="grdt-crit-name">' +
        esc(crit.name || '') +
        '</h3>' +
        (codes ? '<div class="grdt-codes">' + codes + '</div>' : '') +
        '<p class="grsp-words">' +
        esc((crit.levels && (crit.levels[3] || crit.levels['3'])) || '') +
        '</p>' +
        '<div class="grsp-controls"><div class="grdl-seg" role="group" aria-label="Level">' +
        seg +
        '</div>' +
        '</div>' +
        (state.level ? '' : '<span class="grdt-not-scored">' + _NOT_SCORED_ICON + 'Not Scored</span>') +
        '</div>' +
        _singlePointNoteHtml('beyond', a.id, crit, getRubricCriterionBeyond(cid, st.id, a.id, crit)) +
        '</section>';
    });
    return '<div class="grdt-tiles grsp-tiles">' + html + '</div>';
  }

  return {
    configure: configure,
    _CHEVRON_ICON: _CHEVRON_ICON,
    _MODULE_CHEVRON: _MODULE_CHEVRON,
    _MODULE_TRASH: _MODULE_TRASH,
    _RUBRIC_ICON: _RUBRIC_ICON,
    _WARNING_ICON: _WARNING_ICON,
    _getAssessmentCategoryId: _getAssessmentCategoryId,
    _getCategoryName: _getCategoryName,
    _getSortedCategories: _getSortedCategories,
    _returnState: _returnState,
    _singlePointHtml: _singlePointHtml,
    _toolbarState: _toolbarState,
    renderAssessToolbar: renderAssessToolbar,
    setAssessSearch: setAssessSearch,
    sortAssessmentsForList: sortAssessmentsForList,
    toggleCategoryFilter: toggleCategoryFilter,
  };
})();
