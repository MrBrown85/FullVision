// @ts-check
/* assign-form-checks.js — Assignments: the form's snapshot, keys and checks. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignFormChecks = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var _formResSnapshot,
    _hideAfTip,
    _refreshDueHint,
    _refreshFormWorkCard,
    _refreshWorkPeek,
    pageState,
    _compPickerOpen,
    _syncCodes,
    cancelAssessForm,
    updateSectionBadge;
  function configure(h) {
    if ('_formResSnapshot' in h) _formResSnapshot = h._formResSnapshot;
    if ('_hideAfTip' in h) _hideAfTip = h._hideAfTip;
    if ('_refreshDueHint' in h) _refreshDueHint = h._refreshDueHint;
    if ('_refreshFormWorkCard' in h) _refreshFormWorkCard = h._refreshFormWorkCard;
    if ('_refreshWorkPeek' in h) _refreshWorkPeek = h._refreshWorkPeek;
    if ('pageState' in h) pageState = h.pageState;
    if ('_compPickerOpen' in h) _compPickerOpen = h._compPickerOpen;
    if ('_syncCodes' in h) _syncCodes = h._syncCodes;
    if ('cancelAssessForm' in h) cancelAssessForm = h.cancelAssessForm;
    if ('updateSectionBadge' in h) updateSectionBadge = h.updateSectionBadge;
  }

  function _formSnapshot() {
    var val = function (id) {
      return (document.getElementById(id) || /** @type {any} */ ({})).value || '';
    };
    var on = function (sel, key) {
      return Array.from(document.querySelectorAll(sel))
        .map(function (el) {
          return key(el);
        })
        .sort();
    };
    return {
      title: val('af-title'),
      desc: val('af-desc'),
      category: val('af-category'),
      module: val('af-module'),
      assigned: val('af-date-assigned'),
      due: val('af-due'),
      mode: val('af-scoremode') || 'proficiency',
      maxPoints: val('af-maxpoints'),
      weight: val('af-weight'),
      factored: FactorField.factoredOn(document),
      evidence: val('af-evidence'),
      rubric: val('af-rubric'),
      tags: on('.af-tag-cb:checked', function (cb) {
        return cb.value;
      }),
      cc: on('.af-cc-chip.active', function (el) {
        return el.dataset.cc;
      }),
      // Handouts and Links added or removed (_formResSnapshot).
      res: _formResSnapshot(),
      quiz: window.QuizBuilder ? QuizBuilder.snapshot() : '',
      collab: JSON.stringify([
        pageState.newCollaboration || 'individual',
        Array.from(pageState.collabExcluded || []).sort(),
        pageState.collabPairs || [],
        pageState.collabGroups || [],
        pageState.collabGroupCount || 0,
      ]),
    };
  }
  function _markFormStart() {
    pageState._formStart = _formSnapshot();
  }
  // The fields that differ from when the form opened.
  function _formChanges() {
    var now = _formSnapshot();
    var start = pageState._formStart || {};
    return Object.keys(now).filter(function (k) {
      return JSON.stringify(now[k]) !== JSON.stringify(start[k]);
    });
  }

  /* Max Points: more than 0 and up to 9999; decimals are kept (the server
     column is numeric). A bad value stops the save at the box. */
  function _formMaxPoints() {
    var el = /** @type {any} */ (document.getElementById('af-maxpoints'));
    var v = Number(String(el ? el.value : '').trim() || NaN);
    return isFinite(v) && v > 0 && v <= 9999 ? v : null;
  }
  function _formMaxPointsOk() {
    var mode = (document.getElementById('af-scoremode') || /** @type {any} */ ({})).value || 'proficiency';
    if (mode !== 'points' || _formMaxPoints() != null) return true;
    var el = document.getElementById('af-maxpoints');
    if (el) {
      el.style.border = '2px solid var(--score-1)';
      el.setAttribute('aria-invalid', 'true');
      el.focus();
    }
    return false;
  }
  // Typing in Max Points: the quick picks follow the box, and an error clears.
  function _formInput(e) {
    var t = e.target;
    if (!t) return;
    // The next edit clears "Created …" from Create and Add Another.
    var saved = document.getElementById('af-saved-note');
    if (saved && !saved.hidden && t.closest && t.closest('#new-assess-form')) {
      saved.hidden = true;
      saved.textContent = '';
    }
    if (!t.id) return;
    if (t.id === 'af-due' || t.id === 'af-date-assigned') _refreshDueHint();
    // Student Work's late question names the due date; Cece Sees follows the form.
    if (t.id === 'af-due' && e.type === 'change') _refreshFormWorkCard();
    else if (t.id === 'af-title' || t.id === 'af-category' || t.id === 'af-module' || t.id === 'af-due')
      _refreshWorkPeek();
    // A title clears the "Title is required" state as soon as it's typed.
    if (t.id === 'af-title' && t.value.trim()) t.removeAttribute('aria-invalid');
    if (t.id === 'af-maxpoints') {
      t.style.border = '';
      t.removeAttribute('aria-invalid');
      _syncMaxPointsPicks();
    }
    // Factor: typing keeps a good value; leaving the box shows what saves.
    if (t.id === 'af-weight') {
      if (e.type === 'change') FactorField.settle(t);
      else FactorField.track(t);
    }
  }
  // The Max Points quick pick that matches the box is lit; none when none does.
  function _syncMaxPointsPicks() {
    var el = /** @type {any} */ (document.getElementById('af-maxpoints'));
    if (!el) return;
    var v = Number(el.value);
    document.querySelectorAll('#af-maxpoints-picks .seg-btn').forEach(function (b) {
      var hit = String(el.value).trim() !== '' && Number(/** @type {any} */ (b).dataset.value) === v;
      b.classList.toggle('active', hit);
      b.setAttribute('aria-pressed', hit ? 'true' : 'false');
    });
  }

  /* Escape on the New or Edit Assessment form is its Cancel (Nov 3 sweep:
     it did nothing): a form with changes asks first. A tip showing on a
     field closes first; the rubric starts, the competency search and the
     dialogs over the form take their own Escape before this runs. */
  function _formEscape(e) {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
    var form = document.getElementById('new-assess-form');
    if (!pageState._showingNewForm || !form || form.style.display === 'none') return;
    var t = e.target;
    var inForm = t && t.closest && t.closest('#new-assess-form');
    if (!inForm && t !== document.body) return;
    if (document.querySelector('.confirm-overlay, #rubric-modal') || _compPickerOpen()) return;
    if (window.RubricBank && RubricBank.isOpen()) return;
    e.preventDefault();
    if (pageState._afTipSource) return _hideAfTip();
    var aid = pageState._editingAssessId;
    cancelAssessForm(function () {
      // Back to the button that opened the form: the card's ⋯ for Edit
      // Assessment, which sits in its menu.
      var back = aid
        ? document.querySelector('[data-action="editAssess"][data-aid="' + CSS.escape(aid) + '"]')
        : document.querySelector('.tb-action-btn[data-action="showNewForm"]');
      var menu = back && back.closest('.assess-menu');
      if (menu)
        back = /** @type {any} */ (menu.parentNode).querySelector(
          '[data-action="toggleCardMenu"], [data-action="attachWorkMenu"]',
        );
      if (back) /** @type {any} */ (back).focus({ preventScroll: true });
    });
  }

  function _formKeydown(e) {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.altKey) return;
    var form = document.getElementById('new-assess-form');
    if (!form || !form.contains(e.target) || form.style.display === 'none') return;
    // Shift adds another (new assessments only).
    var save = e.shiftKey
      ? form.querySelector('[data-action="saveAndAddAnother"]')
      : form.querySelector('[data-action="saveNewAssess"]:not([data-draft]), [data-action="saveEditAssess"]');
    if (!save) return;
    e.preventDefault();
    /** @type {any} */ (save).click();
  }

  /* The Factor applies to every kind of scoring: the stored one while the
     box shows it, else what was typed, 0.1 to 10 to one decimal
     (FactorField.read). */
  function _formAssessWeight() {
    return FactorField.read(document.getElementById('af-weight'));
  }

  /* A proficiency score only counts through a competency: an assessment with
     none ticked never moves a student's proficiency, so the form says so.
     Letter classes count it in the course %, so they get no note. */
  function _untaggedNote(cid, hasTags) {
    if (courseGradeMode(cid) === 'letter' || getSections(cid).length === 0) return '';
    return (
      '<p class="af-untagged-note" id="af-untagged-note" role="status"' +
      (hasTags ? ' hidden' : '') +
      '>None chosen yet, so this counts toward no proficiency.</p>'
    );
  }
  function _refreshUntaggedNote() {
    var note = document.getElementById('af-untagged-note');
    if (note) note.hidden = !!document.querySelector('.af-tag-cb:checked');
  }

  /* ── Rubric Select in Assessment Form ───────────────────── */
  /* A rubric decides the assessment's competencies (redesign PR 4): picking
     one ticks exactly the competencies its criteria feed, read only while
     it's chosen. Picking None leaves the ticks to edit by hand. */
  // The competencies a rubric scores, its criteria's and the whole rubric's, each once.
  function _rubricTagIds(rubric) {
    return rubricScoredTagIds(rubric);
  }
  // The rubric chosen on the form: one made for it, else a saved one.
  function _formChosenRubric() {
    var sel = /** @type {any} */ (document.getElementById('af-rubric'));
    var rid = sel ? sel.value : '';
    if (!rid) return null;
    if (pageState._pendingFormRubric && pageState._pendingFormRubric.id === rid) return pageState._pendingFormRubric;
    return getRubricById(pageState.activeCourse, rid);
  }

  function onRubricSelect(rubricId) {
    var rubric =
      pageState._pendingFormRubric && rubricId === pageState._pendingFormRubric.id
        ? pageState._pendingFormRubric
        : rubricId
          ? getRubricById(pageState.activeCourse, rubricId)
          : null;
    pageState._rubricAutoTags = [];
    var rubricTagIds = new Set(_rubricTagIds(rubric));
    // A rubric whose criteria score no competency (a Blank draft) leaves
    // the teacher's ticks as they are; one that does ticks exactly its own.
    if (rubricTagIds.size) {
      document.querySelectorAll('.af-tag-cb').forEach(function (cb) {
        var on = rubricTagIds.has(/** @type {any} */ (cb).value);
        if (/** @type {any} */ (cb).checked === on) return;
        /** @type {any} */ (cb).checked = on;
        /** @type {any} */ (cb.parentElement).classList.toggle('checked', on);
        if (on) pageState._rubricAutoTags.push(/** @type {any} */ (cb).value);
        var secId = /** @type {any} */ (cb).dataset.section;
        if (secId) updateSectionBadge(secId);
      });
    }
    var pick = document.getElementById('af-rubric-pick');
    if (pick) pick.hidden = true;
    _refreshUntaggedNote();
    _syncCodes();
  }

  return {
    configure: configure,
    _formAssessWeight: _formAssessWeight,
    _formChanges: _formChanges,
    _formChosenRubric: _formChosenRubric,
    _formEscape: _formEscape,
    _formInput: _formInput,
    _formKeydown: _formKeydown,
    _formMaxPoints: _formMaxPoints,
    _formMaxPointsOk: _formMaxPointsOk,
    _markFormStart: _markFormStart,
    _refreshUntaggedNote: _refreshUntaggedNote,
    _rubricTagIds: _rubricTagIds,
    _syncMaxPointsPicks: _syncMaxPointsPicks,
    _untaggedNote: _untaggedNote,
    onRubricSelect: onRubricSelect,
  };
})();
