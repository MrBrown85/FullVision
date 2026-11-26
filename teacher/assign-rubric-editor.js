// @ts-check
/* assign-rubric-editor.js — Assignments: the rubric editor. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignRubricEditor = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var _blankCardHtml,
    _blankSizeCells,
    _blankState,
    _newBlankDraft,
    _renderRubricView,
    _useRubricInForm,
    _whenWordingLoaded,
    pageState,
    render,
    saveRubricEdit,
    setScoreMode,
    showNewForm,
    openCopyIn;
  function configure(h) {
    if ('_blankCardHtml' in h) _blankCardHtml = h._blankCardHtml;
    if ('_blankSizeCells' in h) _blankSizeCells = h._blankSizeCells;
    if ('_blankState' in h) _blankState = h._blankState;
    if ('_newBlankDraft' in h) _newBlankDraft = h._newBlankDraft;
    if ('_renderRubricView' in h) _renderRubricView = h._renderRubricView;
    if ('_useRubricInForm' in h) _useRubricInForm = h._useRubricInForm;
    if ('_whenWordingLoaded' in h) _whenWordingLoaded = h._whenWordingLoaded;
    if ('pageState' in h) pageState = h.pageState;
    if ('render' in h) render = h.render;
    if ('saveRubricEdit' in h) saveRubricEdit = h.saveRubricEdit;
    if ('setScoreMode' in h) setScoreMode = h.setScoreMode;
    if ('showNewForm' in h) showNewForm = h.showNewForm;
    if ('openCopyIn' in h) openCopyIn = h.openCopyIn;
  }

  /* ── Rubric Builder UI ──────────────────────────────────── */
  /* The Rubrics button's window. It sits under the editor modal, so it
     closes before the editor opens. */
  function openRubricBank() {
    if (!window.RubricBank) return;
    RubricBank.open(pageState.activeCourse, {
      edit: editRubricUI,
      newRubric: newRubricUI,
      remove: deleteRubricUI,
      // Another class's rubric prints blank; this class's opens on its uses.
      print: function (rid, cid) {
        if (!window.RubricPrint) return;
        var other = cid && cid !== pageState.activeCourse;
        RubricPrint.open(other ? cid : pageState.activeCourse, null, {
          rubricId: rid,
          mode: other ? 'blank' : '',
          blankOnly: other,
        });
      },
      // A new form opens on the Blank Rubric draft; the rubric chosen in the
      // bank takes its place, as Choose a Rubric does inside the form.
      useInNew: function (rid) {
        showNewForm();
        if (!document.getElementById('af-rubric')) return;
        setScoreMode('proficiency');
        _useRubricInForm(rid, true);
        _renderRubricView();
      },
      goToAssessment: function (aid) {
        openCopyIn(pageState.activeCourse, aid);
      },
      changed: render,
    });
  }
  function _closeRubricsPanel() {
    if (window.RubricBank) RubricBank.close();
  }
  /* A new rubric in the style the Rubric Bank's "+ New Rubric" menu picks:
     Standard, Advanced, Single-Point or Six-Point. `template` is one of the
     English 12 scoring guides (SixPoint.templates), a Six-Point rubric with
     its wording and checkboxes filled in. */
  function newRubricUI(style, template) {
    _closeRubricsPanel();
    _whenWordingLoaded();
    pageState._rubricBefore = null;
    var next = rubricStyle({ style: style });
    var draft;
    if (template && window.RubricScale) draft = RubricScale.fromTemplate(template, uid);
    else {
      draft = _newBlankDraft();
      draft.style = next;
      // "Six-Point Rubric": the six-point columns, no wording yet.
      if (style === 'six_point') {
        draft.style = 'advanced';
        draft.scale = RubricScale.BC_SIX.map(function (c) {
          return Object.assign({}, c);
        });
        draft.criteria[0].name = 'Overall';
      }
    }
    draft.created = new Date().toISOString();
    _openRubricModal(draft, true, !!template);
  }
  function editRubricUI(rubricId) {
    var rubric = getRubricById(pageState.activeCourse, rubricId);
    if (!rubric) return;
    pageState._rubricBefore = structuredClone(rubric);
    pageState._rubricScored = RubricGuard.scoredStudentsByCriterion(pageState.activeCourse, rubric);
    _openRubricModal(structuredClone(rubric), false, false);
  }

  function _openRubricModal(draft, isNew, touched) {
    _closeRubricsPanel();
    _whenWordingLoaded();
    if (isNew) {
      pageState._rubricBefore = null;
      pageState._rubricScored = {};
    }
    if (pageState._blank && pageState._blank.host !== 'modal') pageState._formBlank = pageState._blank;
    pageState._blank = _blankState(draft, true);
    pageState._blank.host = 'modal';
    pageState._blank.isNew = isNew;
    // A template is written in already: Cancel asks before dropping it.
    if (touched) pageState._blank.orig = '';
    _renderRubricModal('#af-ge-name');
    _blankSizeCells();
  }
  function _renderRubricModal(focusSel) {
    if (!pageState._blank || pageState._blank.host !== 'modal') return;
    var modal = document.getElementById('rubric-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'rubric-modal-overlay rb-ed-overlay';
      modal.id = 'rubric-modal';
      modal.setAttribute('data-action', 'rubricModalBackdrop');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', pageState._blank.isNew ? 'New Rubric' : 'Edit Rubric');
      document.body.appendChild(modal);
    }
    var note = pageState._rubricBefore
      ? RubricGuard.topChangeNote(
          RubricGuard.reviewEdit(pageState._rubricBefore, pageState._blank.draft, pageState._rubricScored),
        )
      : '';
    // html-safe: _blankCardHtml escapes every name, label and descriptor; the note is set as text below
    modal.innerHTML =
      '<div class="rb-ed-window"><div class="rb-ed-head"><h2 class="rb-ed-title">' +
      (pageState._blank.isNew ? 'New Rubric' : 'Edit Rubric') +
      '</h2><p class="rb-ed-hint" id="rb-ed-hint"></p>' +
      '<button type="button" class="rubric-editor-close" data-action="cancelRubricEdit" title="Close" aria-label="Close">\u2715</button></div>' +
      '<p class="rubric-guard-note" id="re-guard-note" hidden></p>' +
      _blankCardHtml(pageState.activeCourse, true) +
      '</div>';
    var hint = document.getElementById('rb-ed-hint');
    if (hint) hint.textContent = _RUBRIC_STYLE_HINTS[rubricStyle(pageState._blank.draft)] || '';
    var guard = document.getElementById('re-guard-note');
    if (guard) {
      guard.textContent = note;
      guard.hidden = !note;
    }
    if (focusSel) {
      var to = modal.querySelector(focusSel);
      if (to) to.focus({ preventScroll: true });
    }
  }
  function _closeRubricModal() {
    var modal = document.getElementById('rubric-modal');
    if (modal) modal.remove();
    pageState._blank = pageState._formBlank;
    pageState._formBlank = null;
    pageState._editingRubric = null;
    pageState._rubricBefore = null;
    pageState._rubricScored = {};
    pageState._rubricDirty = false;
  }
  /* Save Rubric in the window: into the class's rubrics, as the editor
     always saved (saveRubricEdit). */
  function _saveModalRubric() {
    var d = pageState._blank.draft;
    var name = String(d.name || '').trim();
    var input = /** @type {any} */ (document.querySelector('#rubric-modal #af-ge-name'));
    if (!name) {
      if (input) {
        input.classList.add('is-invalid');
        input.placeholder = 'Name this rubric to save it';
        input.focus();
      }
      return;
    }
    var held = structuredClone(d);
    held.name = name;
    held.criteria = held.criteria.map(function (c, n) {
      return Object.assign(c, { name: String(c.name || '').trim() || 'Criterion ' + (n + 1) });
    });
    if (pageState._blank.isNew) held._isNew = true;
    if (pageState._blank.forForm) held._forForm = true;
    pageState._editingRubric = held;
    var before = pageState._rubricBefore;
    var scored = pageState._rubricScored;
    pageState._blank = pageState._formBlank;
    pageState._formBlank = null;
    pageState._rubricBefore = before;
    pageState._rubricScored = scored;
    saveRubricEdit(name);
  }
  function deleteRubricUI(rubricId) {
    var rubric = getRubricById(pageState.activeCourse, rubricId);
    if (!rubric) return;
    if (window.RubricBank) {
      RubricBank.confirmDelete(pageState.activeCourse, rubricId, function () {
        deleteRubric(pageState.activeCourse, rubricId);
        render();
        RubricBank.refresh();
      });
      return;
    }
    var linked = getAssessments(pageState.activeCourse).filter(function (a) {
      return a.rubricId === rubricId;
    }).length;
    var msg =
      linked > 0
        ? '"' +
          rubric.name +
          '" is linked to ' +
          linked +
          ' assessment(s). They will lose their rubric link. Delete anyway?'
        : 'Delete rubric "' + rubric.name + '"?';
    if (window.RubricLibrary) msg += RubricLibrary.deleteNote(pageState.activeCourse, rubric);
    showConfirm('Delete Rubric', msg, 'Delete', 'danger', function () {
      deleteRubric(pageState.activeCourse, rubricId);
      render();
      if (window.RubricBank) RubricBank.refresh();
    });
  }

  var _RUBRIC_STYLE_NAMES = {
    standard: 'Standard',
    advanced: 'Advanced',
    single_point: 'Single-Point',
    six_point: 'Six-Point',
  };

  var _RUBRIC_STYLE_HINTS = {
    standard: '',
    advanced:
      'Each level has a descriptor and checkboxes. When scoring, ticking boxes suggests the level: the highest level whose boxes are all ticked. You can always pick a different level.',
    single_point:
      'Write only what meeting the standard looks like. When scoring, you pick a level and can note what to work on and where the student went beyond.',
    six_point:
      'The BC six-point scale, scored holistically: 6 Superior to 1 Unacceptable. Each score has a descriptor and checkboxes; ticking boxes suggests the highest score whose boxes are all ticked. Each score counts as the FullVision level shown under it. A blank paper (NR) is Missing.',
  };

  return {
    configure: configure,
    _RUBRIC_STYLE_NAMES: _RUBRIC_STYLE_NAMES,
    _closeRubricModal: _closeRubricModal,
    _openRubricModal: _openRubricModal,
    _renderRubricModal: _renderRubricModal,
    _saveModalRubric: _saveModalRubric,
    deleteRubricUI: deleteRubricUI,
    editRubricUI: editRubricUI,
    newRubricUI: newRubricUI,
    openRubricBank: openRubricBank,
  };
})();
