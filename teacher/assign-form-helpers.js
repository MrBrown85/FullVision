// @ts-check
/* assign-form-helpers.js — Assignments: the form's helpers. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignFormHelpers = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var pageState, _blankWritten, _formAssessWeight, _syncCodes;
  function configure(h) {
    if ('pageState' in h) pageState = h.pageState;
    if ('_blankWritten' in h) _blankWritten = h._blankWritten;
    if ('_formAssessWeight' in h) _formAssessWeight = h._formAssessWeight;
    if ('_syncCodes' in h) _syncCodes = h._syncCodes;
  }

  /* ── Assessment Form Helpers ────────────────────────────── */
  /* A new Date Assigned moves Due Date with it only while Due is still the
     week-later date it was given (or empty); a due date the teacher set
     stays. */
  /* A due date before the date assigned is said under the field as it is
     picked; the card read "Nov 3, 2026 → Nov 2, 2026" with no word (Nov 3
     sweep). Information only: Save still saves. */
  var DUE_BEFORE_ASSIGNED_HINT = 'The due date is before the date assigned.';
  function _dueBeforeAssigned(assigned, due) {
    return !!(assigned && due && due < assigned);
  }
  function _refreshDueHint() {
    var hint = document.getElementById('af-due-hint');
    if (!hint) return;
    hint.hidden = !_dueBeforeAssigned(
      /** @type {any} */ (document.getElementById('af-date-assigned') || {}).value,
      /** @type {any} */ (document.getElementById('af-due') || {}).value,
    );
  }
  function _weekAfter(day) {
    var d = new Date(day + 'T12:00:00');
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }
  function autoSetDueDate() {
    var assigned = /** @type {any} */ (document.getElementById('af-date-assigned'));
    if (!assigned || !assigned.value) return;
    var was = assigned.dataset.was || assigned.defaultValue || '';
    assigned.dataset.was = assigned.value;
    var dueEl = /** @type {any} */ (document.getElementById('af-due'));
    if (!dueEl) return;
    if (!(dueEl.value && !(was && dueEl.value === _weekAfter(was)))) dueEl.value = _weekAfter(assigned.value);
    _refreshDueHint();
  }

  function setScoreMode(mode) {
    // "The same as your last assessment" is true only until another is picked.
    var last = document.getElementById('af-score-last');
    if (last) last.hidden = true;
    document.querySelectorAll('.af-scoremode-btn').forEach(function (b) {
      b.setAttribute('aria-checked', /** @type {any} */ (b).dataset.mode === mode ? 'true' : 'false');
    });
    var el = /** @type {any} */ (document.getElementById('af-scoremode'));
    if (el) el.value = mode;
    // Each mode shows only what it needs; what's hidden keeps its value
    // until save, so switching back finds it as it was.
    var show = { 'af-maxpoints-wrap': mode === 'points', 'af-rubric-wrap': mode === 'proficiency' };
    show['af-dibels-note'] = mode === 'dibels';
    show['af-comp-note'] = mode === 'competencies';
    show['af-weight-wrap'] = mode !== 'dibels';
    Object.keys(show).forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.hidden = !show[id];
    });
    _syncCodes();
  }

  /* Competencies is the form's name for proficiency work with no rubric:
     each tagged competency is scored on its own, Emerging to Extending, the
     way it always was (scoreMode 'proficiency', no rubricId). Only the form
     tells it from Rubric; what is saved and the grade math are the same. */
  var COMPETENCIES_NEED_TAG_HINT =
    'Tag at least one competency above. Each one you tag is what students are scored on.';
  function _storedScoreMode(mode) {
    return mode === 'competencies' ? 'proficiency' : mode || 'proficiency';
  }
  // Work whose saved rubric is gone scores its competencies, as its card says.
  // cid: the class the work is in (Start From Past can bring it from another).
  function _formModeOf(a, cid) {
    var m = (a && a.scoreMode) || 'proficiency';
    var held = !!a.rubricId && pageState._pendingFormRubric && pageState._pendingFormRubric.id === a.rubricId;
    var gone = !!a.rubricId && !held && !getRubricById(cid || pageState.activeCourse, a.rubricId);
    return m === 'proficiency' && (!a.rubricId || gone) ? 'competencies' : m;
  }
  /* The scoring of the class's most recently made assessment, when it can be
     offered on a new one; null with none. */
  function _lastScoreMode(cid) {
    var list = (getAssessments(cid) || []).filter(function (a) {
      return a && !a.deletedAt;
    });
    if (!list.length) return null;
    var last = list.reduce(function (best, a) {
      return String(a.created || '') >= String(best.created || '') ? a : best;
    }, list[0]);
    var m = _formModeOf(last, cid);
    if (m === 'dibels' && !courseOffersDibels(COURSES[cid])) return null;
    if (m === 'competencies' && !getSections(cid).length) return null;
    return m;
  }
  function _formMode() {
    return /** @type {any} */ (document.getElementById('af-scoremode') || {}).value || 'proficiency';
  }
  // Shows the Competencies hint while no competency is tagged; true when shown.
  function _refreshCompHint() {
    var hint = document.getElementById('af-comp-hint');
    if (!hint) return false;
    var show = _formMode() === 'competencies' && !document.querySelector('.af-tag-cb:checked');
    hint.hidden = !show;
    return show;
  }
  /* A save of Competencies work with nothing tagged stops at the hint and
     brings the competency list into view. */
  function _formCompetencyTagged() {
    if (!_refreshCompHint()) return true;
    var card = document.querySelector('.af-card-competencies');
    if (card && card.scrollIntoView) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    var first = document.getElementById('af-comp-choose');
    if (first) first.focus({ preventScroll: true });
    return false;
  }

  // The ways to score an assessment, as cards with an icon each. No hover
  // preview: it covered the rubric editor (Colin, Nov 4).
  var SCORE_MODE_CARDS = [
    {
      mode: 'proficiency',
      // Proficiency work on a rubric of its own; with no rubric it is
      // Competencies below (Colin, Nov 3). The 1–4 scale is proficiency.
      label: 'Rubric',
      icon: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 16v-3"/><path d="M8 16v-6"/><path d="M12 16v-9"/><path d="M16 16V4"/></svg>',
    },
    {
      mode: 'points',
      label: 'Points',
      icon: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 3 6 17"/><path d="M14 3l-2 14"/><path d="M3.5 7.5h13"/><path d="M3 12.5h13"/></svg>',
    },
    {
      mode: 'complete',
      label: 'Complete/Incomplete',
      icon: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="m6.8 10.2 2.2 2.2 4.2-4.6"/></svg>',
    },
    {
      mode: 'competencies',
      label: 'Competencies',
      icon: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5.5h8"/><path d="M3 10h8"/><path d="M3 14.5h8"/><circle cx="15.5" cy="5.5" r="1.4"/><circle cx="15.5" cy="10" r="1.4"/><circle cx="15.5" cy="14.5" r="1.4"/></svg>',
    },
    {
      mode: 'dibels',
      label: 'DIBELS 8 Benchmark',
      icon: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h5a2 2 0 0 1 2 2V16a1.5 1.5 0 0 0-1.5-1.5H3z"/><path d="M17 4.5h-5a2 2 0 0 0-2 2V16a1.5 1.5 0 0 1 1.5-1.5H17z"/></svg>',
    },
  ];

  /* What an assessment is worth in the course %, in a sentence, for the
     line under the grader's title (the form shows the share bar):
     "Counts as 20 points in Current Events (5 criteria)." Empty when the
     class shows no % or the work counts toward no grade. */
  function _countsAsText(cid, a) {
    var w = assessmentCourseWorth(cid, a);
    if (!w) return '';
    if (w.kind === 'uncategorized') return 'Has no category, so it doesn’t count toward the course %.';
    if (w.kind === 'zero')
      return 'Is in ' + w.category + ', which is worth 0%, so it doesn’t count toward the course %.';
    var where = w.category ? ' in ' + w.category : ' toward the course %';
    if (w.kind === 'percent') {
      return w.factor === 1
        ? 'Counts as one assessment' + where + ', the same as every other.'
        : 'Counts ' + formatPoints(w.factor) + ' times' + where + ' (Factor ' + formatFactor(w.factor) + ').';
    }
    var parts = [];
    if (w.criteria) parts.push(w.criteria + (w.criteria === 1 ? ' criterion' : ' criteria'));
    if (w.factor !== 1) parts.push(formatPoints(w.base) + ' points, Factor ' + formatFactor(w.factor));
    return (
      'Counts as ' +
      formatPoints(w.points) +
      (w.points === 1 ? ' point' : ' points') +
      where +
      (parts.length ? ' (' + parts.join(', ') + ')' : '') +
      '.'
    );
  }

  /* The rubric the form is building, for the Counts As line: the Blank
     Rubric while it is open or written in, else a rubric made on the form
     and held unsaved. Null: a saved rubric, looked up by its id. */
  function _formDraftRubric(rid) {
    if (pageState._blank && (pageState._startOpen === 'blank' || _blankWritten())) return pageState._blank.draft;
    if (pageState._pendingFormRubric && pageState._pendingFormRubric.id === rid) return pageState._pendingFormRubric;
    return null;
  }

  /* The form's share bar, from what the form says now: this assessment's
     part of its category as the course % counts it, live as the Factor,
     points, rubric or category change. */
  function _refreshFormCountsAs() {
    _refreshCountsToward();
    var line = document.getElementById('af-counts-as');
    if (!line) return;
    var mode = /** @type {any} */ (document.getElementById('af-scoremode') || {}).value || 'proficiency';
    // The Category field's hint already says why work with none is short.
    if (_refreshCategoryHint()) {
      FactorField.renderBar(line, null);
      return;
    }
    var rid = mode === 'proficiency' ? /** @type {any} */ (document.getElementById('af-rubric') || {}).value || '' : '';
    var title = ((document.getElementById('af-title') || /** @type {any} */ ({})).value || '').trim();
    var info = assessmentCategoryShare(pageState.activeCourse, {
      id: pageState._editingAssessId,
      title: title,
      categoryId: /** @type {any} */ (document.getElementById('af-category') || {}).value || '',
      rubricId: rid,
      rubric: mode === 'proficiency' ? _formDraftRubric(rid) : null,
      scoreMode: _storedScoreMode(mode),
      maxPoints: parseFloat(/** @type {any} */ (document.getElementById('af-maxpoints') || {}).value) || 0,
      weight: _formAssessWeight(),
    });
    FactorField.renderBar(line, info, title);
  }

  function _refreshCategoryHint() {
    var sel = /** @type {any} */ (document.getElementById('af-category'));
    var hint = document.getElementById('af-category-hint');
    if (!sel || !hint) return false;
    var mode = /** @type {any} */ (document.getElementById('af-scoremode') || {}).value || 'proficiency';
    var show = !sel.value && categoryRequired(pageState.activeCourse, { scoreMode: _storedScoreMode(mode) });
    hint.hidden = !(show && pageState._categoryTried);
    if (!show) {
      sel.style.border = '';
      sel.removeAttribute('aria-invalid');
    }
    return show;
  }

  /* A save of scored work with no category, in a class with categories,
     stops at the Category field. */
  function _formCategoryChosen() {
    if (!_refreshCategoryHint()) return true;
    pageState._categoryTried = true;
    _refreshCategoryHint();
    var sel = /** @type {any} */ (document.getElementById('af-category'));
    sel.style.border = '2px solid var(--score-1)';
    sel.setAttribute('aria-invalid', 'true');
    sel.focus();
    return false;
  }

  function _countsAsAfterEvent() {
    if (document.getElementById('af-counts-as') || document.getElementById('af-counts-toward'))
      setTimeout(_refreshFormCountsAs, 0);
  }

  /* The footer's line: what the work counts toward, from the form as it
     stands: the category and its weight, the competencies ticked, and the
     reporting term its date falls in. DIBELS counts toward no grade. */
  function _countsTowardText(cid) {
    var mode = /** @type {any} */ (document.getElementById('af-scoremode') || {}).value || 'proficiency';
    if (mode === 'dibels') return { strong: 'Counts toward no grade.', rest: '' };
    var catSel = /** @type {any} */ (document.getElementById('af-category'));
    var catId = catSel ? catSel.value : '';
    var cat = catId ? getCategoryById(cid, catId) : null;
    var codes = Array.from(document.querySelectorAll('.af-tag-cb:checked')).map(function (cb) {
      var tag = typeof getTagById === 'function' ? getTagById(cid, /** @type {any} */ (cb).value) : null;
      return (tag && (tag.code || tag.id)) || /** @type {any} */ (cb).value;
    });
    var parts = [];
    if (cat) parts.push(cat.name + ' (' + Number(cat.weight || 0) + '%)');
    if (codes.length) parts.push(codes.join(', '));
    var date = /** @type {any} */ (document.getElementById('af-date-assigned') || {}).value || '';
    var terms = typeof getReportingTerms === 'function' ? getReportingTerms(cid) : [];
    if (terms.length && date) {
      var term = terms.find(function (t) {
        return date >= t.starts_on && date <= t.ends_on;
      });
      parts.push(term ? term.label : 'In no reporting term');
    }
    if (!catId && categoryRequired(cid, { scoreMode: _storedScoreMode(mode) }))
      return { strong: 'Needs a category', rest: 'to count toward the grade.' };
    if (!codes.length && courseGradeMode(cid) !== 'letter' && getSections(cid).length)
      return {
        strong: 'No competency is chosen,',
        rest: 'so it counts toward no proficiency.' + (parts.length ? ' ' + parts.join(' · ') : ''),
      };
    return parts.length ? { strong: 'Counts toward', rest: parts.join(' · ') } : { strong: '', rest: '' };
  }
  function _refreshCountsToward() {
    var line = document.getElementById('af-counts-toward');
    if (!line) return;
    var t = _countsTowardText(pageState.activeCourse);
    line.textContent = '';
    if (t.strong) {
      var b = document.createElement('strong');
      b.textContent = t.strong;
      line.appendChild(b);
    }
    if (t.rest) line.appendChild(document.createTextNode((t.strong ? ' ' : '') + t.rest));
  }

  return {
    configure: configure,
    COMPETENCIES_NEED_TAG_HINT: COMPETENCIES_NEED_TAG_HINT,
    DUE_BEFORE_ASSIGNED_HINT: DUE_BEFORE_ASSIGNED_HINT,
    SCORE_MODE_CARDS: SCORE_MODE_CARDS,
    _countsAsAfterEvent: _countsAsAfterEvent,
    _countsAsText: _countsAsText,
    _dueBeforeAssigned: _dueBeforeAssigned,
    _formCategoryChosen: _formCategoryChosen,
    _formCompetencyTagged: _formCompetencyTagged,
    _formMode: _formMode,
    _formModeOf: _formModeOf,
    _lastScoreMode: _lastScoreMode,
    _refreshCategoryHint: _refreshCategoryHint,
    _refreshCompHint: _refreshCompHint,
    _refreshCountsToward: _refreshCountsToward,
    _refreshDueHint: _refreshDueHint,
    _storedScoreMode: _storedScoreMode,
    _weekAfter: _weekAfter,
    autoSetDueDate: autoSetDueDate,
    setScoreMode: setScoreMode,
  };
})();
