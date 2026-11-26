// @ts-check
/* assign-rubric-criteria.js — Assignments: a rubric's level checkboxes and criteria from competencies. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignRubricCriteria = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var _cancelBlank, _holdFormRubric, _syncCodes, onRubricSelect, openStart, pageState, render;
  function configure(h) {
    if ('_cancelBlank' in h) _cancelBlank = h._cancelBlank;
    if ('_holdFormRubric' in h) _holdFormRubric = h._holdFormRubric;
    if ('_syncCodes' in h) _syncCodes = h._syncCodes;
    if ('onRubricSelect' in h) onRubricSelect = h.onRubricSelect;
    if ('openStart' in h) openStart = h.openStart;
    if ('pageState' in h) pageState = h.pageState;
    if ('render' in h) render = h.render;
  }

  /* ── Advanced Rubrics: the checkboxes in each level cell ──────────── */
  /* Replace one level's checkboxes, renumbering them; other levels stay. */
  function _setLevelChecks(crit, level, list) {
    var others = (crit.checks || []).filter(function (k) {
      return k && Number(k.level) !== level;
    });
    list.forEach(function (k, i) {
      k.level = level;
      k.displayOrder = i;
    });
    crit.checks = others.concat(list);
  }
  /* A checkbox without a label is nothing to save. */
  function _dropBlankChecks(rubric) {
    if (window.RubricCommentLines) RubricCommentLines.dropBlank(rubric);
    (rubric.criteria || []).forEach(function (c) {
      if (!c || !c.checks) return;
      [6, 5, 4, 3, 2, 1].forEach(function (level) {
        _setLevelChecks(
          c,
          level,
          RubricChecks.checksAt(c, level).filter(function (k) {
            return String(k.label || '').trim();
          }),
        );
      });
    });
  }
  /* ── Criteria from competencies (shared/rubric-draft.js) ─── */
  function _whenWordingLoaded() {
    return Promise.resolve(typeof loadCompetencyDescriptors === 'function' ? loadCompetencyDescriptors() : null).catch(
      function () {
        return null;
      },
    );
  }
  function cancelRubricEdit() {
    if (pageState._blank && pageState._blank.host === 'modal') return _cancelBlank();
    // P7.8: route through the in-app confirm dialog so it matches the rest of
    // the destructive-action UX (focus trap, Esc handling, restored focus).
    function _doCancel() {
      pageState._editingRubric = null;
      pageState._rubricBefore = null;
      pageState._rubricScored = {};
      pageState._rubricDirty = false;
      var modal = document.getElementById('rubric-modal');
      if (modal) modal.remove();
    }
    if (!pageState._rubricDirty) {
      _doCancel();
      return;
    }
    showConfirm(
      'Discard rubric changes?',
      'Your unsaved edits to this rubric will be lost.',
      'Discard',
      'danger',
      _doCancel,
    );
  }
  function saveRubricEdit(givenName) {
    if (!pageState._editingRubric) return;
    var nameInput = /** @type {any} */ (document.getElementById('re-name'));
    var rubricName = givenName || (nameInput ? nameInput.value : '').trim();
    if (!rubricName) {
      if (nameInput) {
        nameInput.style.border = '2px solid var(--score-1)';
        nameInput.placeholder = 'Rubric name is required';
        nameInput.focus();
      }
      return;
    }
    pageState._editingRubric.name = rubricName;
    if (!pageState._editingRubric.criteria || pageState._editingRubric.criteria.length === 0) {
      alert('Add at least one criterion.');
      return;
    }
    pageState._editingRubric.style = rubricStyle(pageState._editingRubric);
    _dropBlankChecks(pageState._editingRubric);
    // A criterion with no competency is allowed: it counts toward the
    // overall grade only.
    var cid = pageState.activeCourse;
    // Made from the assessment form: held, unsaved, until the assessment is
    // created (redesign PR 8).
    if (pageState._editingRubric._forForm && pageState._showingNewForm) {
      var held = structuredClone(pageState._editingRubric);
      delete held._forForm;
      delete held._isNew;
      pageState._editingRubric = null;
      pageState._rubricBefore = null;
      pageState._rubricScored = {};
      pageState._rubricDirty = false;
      var heldModal = document.getElementById('rubric-modal');
      if (heldModal) heldModal.remove();
      _holdFormRubric(held);
      return;
    }
    delete pageState._editingRubric._forForm;
    var rubrics = structuredClone(getRubrics(cid));
    var isNew = pageState._editingRubric._isNew;
    delete pageState._editingRubric._isNew;
    if (isNew) rubrics.push(pageState._editingRubric);
    else {
      var idx = rubrics.findIndex(function (r) {
        return r.id === pageState._editingRubric.id;
      });
      if (idx >= 0) rubrics[idx] = pageState._editingRubric;
      else rubrics.push(pageState._editingRubric);
    }
    var savedId = pageState._editingRubric.id;
    var criteriaCount = (pageState._editingRubric.criteria || []).length;
    var savePromise = saveRubrics(cid, rubrics);
    // The teacher's own wording for a competency starts its next draft.
    if (window.RubricDraft && typeof saveCompetencyDescriptors === 'function') {
      saveCompetencyDescriptors(
        RubricDraft.savedEntries(
          pageState._editingRubric,
          function (id) {
            return getTagById(cid, id);
          },
          getCompetencyDescriptor,
        ),
      );
    }
    // The rubric as it was and as saved, for "Update the other classes too?".
    var linkedBefore = pageState._rubricBefore;
    var linkedAfter = structuredClone(pageState._editingRubric);
    pageState._editingRubric = null;
    pageState._rubricBefore = null;
    pageState._rubricScored = {};
    pageState._rubricDirty = false;
    var modal = document.getElementById('rubric-modal');
    if (modal) modal.remove();
    // "+ New Rubric" opens over a half-filled assessment form: keep it.
    if (pageState._showingNewForm) rerenderKeeping('new-assess-form', render);
    else render();
    Promise.resolve(savePromise).then(function (result) {
      if (linkedBefore && linkedAfter.copyGroup && window.RubricLibrary) {
        var finalId = result && result.idMap && result.idMap[savedId] ? result.idMap[savedId] : savedId;
        var saved =
          (result && Array.isArray(result.rubrics) ? result.rubrics : getRubrics(cid)).find(function (r) {
            return r.id === finalId;
          }) || linkedAfter;
        RubricLibrary.offerLinkedEdit(cid, linkedBefore, saved).then(function (names) {
          if (names && names.length) render();
        });
      }
      setTimeout(function () {
        var dd = /** @type {any} */ (document.getElementById('af-rubric'));
        if (!dd) return;
        dd.setAttribute('data-keep', dd.value);
        var freshRubrics = result && Array.isArray(result.rubrics) ? result.rubrics : getRubrics(cid);
        dd.innerHTML =
          '<option value="">None</option>' +
          freshRubrics
            .map(function (r) {
              return (
                '<option value="' + esc(r.id) + '">' + esc(r.name) + ' (' + r.criteria.length + ' criteria)</option>'
              );
            })
            .join('');
        var finalId = result && result.idMap && result.idMap[savedId] ? result.idMap[savedId] : savedId;
        if (
          !freshRubrics.find(function (r) {
            return r.id === finalId;
          })
        ) {
          var fallback = freshRubrics.find(function (r) {
            return r.name === rubricName && (r.criteria || []).length === criteriaCount;
          });
          if (fallback) finalId = fallback.id;
        }
        var keep = dd.getAttribute('data-keep') || '';
        if (isNew && finalId) {
          dd.value = finalId;
          onRubricSelect(finalId);
        } else {
          if (keep) dd.value = keep;
          _syncCodes();
        }
      }, 100);
    });
  }
  function newRubricFromForm() {
    openStart('blank');
  }
  /* Copy a rubric from another class into this one and select it on the form. */
  function rubricFromClass() {
    openStart('copy');
  }

  return {
    configure: configure,
    _dropBlankChecks: _dropBlankChecks,
    _whenWordingLoaded: _whenWordingLoaded,
    cancelRubricEdit: cancelRubricEdit,
    newRubricFromForm: newRubricFromForm,
    rubricFromClass: rubricFromClass,
    saveRubricEdit: saveRubricEdit,
  };
})();
