// @ts-check
/* assign-copy-class-view.js — Assignments: scored-work asks, the Competency Rubric, and the competency picker's hooks. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignCopyClassView = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var _afGroupBox,
    _afSecTagIds,
    _focusRubricCard,
    _formChosenRubric,
    _formMode,
    _hideAfTip,
    _refreshCompHint,
    _renderRubricView,
    _rubricNameFrom,
    _rubricTagIds,
    _storedScoreMode,
    pageState,
    setScoreMode,
    _formDialog,
    _holdFormRubric,
    _openRubricModal,
    onTagChange;
  function configure(h) {
    if ('_afGroupBox' in h) _afGroupBox = h._afGroupBox;
    if ('_afSecTagIds' in h) _afSecTagIds = h._afSecTagIds;
    if ('_focusRubricCard' in h) _focusRubricCard = h._focusRubricCard;
    if ('_formChosenRubric' in h) _formChosenRubric = h._formChosenRubric;
    if ('_formMode' in h) _formMode = h._formMode;
    if ('_hideAfTip' in h) _hideAfTip = h._hideAfTip;
    if ('_refreshCompHint' in h) _refreshCompHint = h._refreshCompHint;
    if ('_renderRubricView' in h) _renderRubricView = h._renderRubricView;
    if ('_rubricNameFrom' in h) _rubricNameFrom = h._rubricNameFrom;
    if ('_rubricTagIds' in h) _rubricTagIds = h._rubricTagIds;
    if ('_storedScoreMode' in h) _storedScoreMode = h._storedScoreMode;
    if ('pageState' in h) pageState = h.pageState;
    if ('setScoreMode' in h) setScoreMode = h.setScoreMode;
    if ('_formDialog' in h) _formDialog = h._formDialog;
    if ('_holdFormRubric' in h) _holdFormRubric = h._holdFormRubric;
    if ('_openRubricModal' in h) _openRubricModal = h._openRubricModal;
    if ('onTagChange' in h) onTagChange = h.onTagChange;
  }

  /* Editing scored work (redesign PR 9): changing its scoring or its rubric
     asks first and names how many students it touches. Scores are kept
     under the rubric's criteria and the scoring they were given in. */
  function _askBeforeScoredChange(what, go, nextMode) {
    var aid = pageState._editingAssessId;
    var scored = aid ? _scoredStudentCount(pageState.activeCourse, aid) : 0;
    var current = (document.getElementById('af-scoremode') || /** @type {any} */ ({})).value || 'proficiency';
    var keepsScores =
      what === 'scoring' &&
      (nextMode === current ||
        (_storedScoreMode(nextMode) === _storedScoreMode(current) &&
          !(current === 'proficiency' && (document.getElementById('af-rubric') || /**@type {*}*/ ({})).value)));
    if (!scored || keepsScores) return go();
    var title = ((document.getElementById('af-title') || /**@type {*}*/ ({})).value || '').trim() || 'This assessment';
    var who = scored + (scored === 1 ? ' student' : ' students');
    _formDialog(
      what === 'scoring' ? 'Change the Scoring?' : 'Change the Rubric?',
      what === 'scoring'
        ? title +
            ' has scores for ' +
            who +
            '. They were given in the current scoring and count differently once you save a new one.'
        : title +
            ' has scores for ' +
            who +
            ' on its current rubric\u2019s criteria. A different rubric starts unscored.',
      [
        { label: 'Cancel', style: 'cancel' },
        { label: what === 'scoring' ? 'Change the Scoring' : 'Change the Rubric', style: 'danger', run: go },
      ],
    );
  }

  // How many students have a score or feedback on an assessment.
  function _scoredStudentCount(cid, aid) {
    return getStudents(cid).filter(function (st) {
      return typeof hasScoreOrFeedback === 'function' && hasScoreOrFeedback(cid, st.id, aid);
    }).length;
  }

  /* Edit a Copy: the rubric with new ids, named after the assessment, opened
     in the editor; it's saved only when the assessment is created. */
  function editRubricCopyForForm(rid) {
    var cid = pageState.activeCourse;
    var src = getRubricById(cid, rid);
    if (!src) return;
    var copy = structuredClone(src);
    copy.id = uid();
    delete copy.copyGroup;
    copy.criteria = (copy.criteria || []).map(function (c) {
      var next = Object.assign({}, c, { id: uid() });
      if (c.checks)
        next.checks = window.RubricLibrary
          ? RubricLibrary.freshChecks(c.checks)
          : c.checks.map(function (k) {
              return Object.assign({}, k, { id: uid() });
            });
      return next;
    });
    // Where each criterion and checkbox came from (copy id → original id),
    // so this assessment's scores can move to the copy when it's saved
    // (PR 10). Criteria added, removed or reordered in the editor keep or
    // lose their entry by id, never by position.
    if (pageState._editingAssessId && _scoredStudentCount(cid, pageState._editingAssessId)) {
      var from = { criteria: {}, checks: {} };
      (src.criteria || []).forEach(function (c, i) {
        var made = copy.criteria[i];
        if (!made) return;
        from.criteria[made.id] = c.id;
        (c.checks || []).forEach(function (k, j) {
          var mk = (made.checks || [])[j];
          if (mk) from.checks[mk.id] = k.id;
        });
      });
      copy._copiedFrom = from;
    }
    var title = ((document.getElementById('af-title') || /** @type {any} */ ({})).value || '').trim();
    copy.name = src.name + (title ? ' · ' + title : ' (Copy)');
    copy.title = copy.name;
    _openFormRubricEditor(copy);
  }

  // Edit a Copy: the copy opens in the editor window, held for the form on save.
  function _openFormRubricEditor(rubric) {
    _openRubricModal(rubric, true, true);
    pageState._blank.forForm = true;
  }

  /* Use This Rubric (rubric starts PR 2, replacing Draft From
     Competencies): the Competency Rubric becomes this assessment's rubric,
     a criterion per competency with the wording shown (the teacher's own,
     else the bank's, else the BC scale's). It's held like any rubric made
     on the form and saved when the assessment is; Edit Rubric changes it. */
  function useCompetencyRubric() {
    // Scored competencies stop showing once a rubric scores by criterion:
    // ask first, as changing the scoring does.
    // ('rubric' stands for the rubric scoring the scores don't carry into.)
    if (_formMode() === 'competencies') return _askBeforeScoredChange('scoring', _useCompetencyRubric, 'rubric');
    _useCompetencyRubric();
  }
  function _useCompetencyRubric() {
    var cid = pageState.activeCourse;
    var tags = Array.from(document.querySelectorAll('.af-tag-cb:checked'))
      .map(function (cb) {
        return getTagById(cid, /** @type {any} */ (cb).value);
      })
      .filter(Boolean);
    if (!tags.length || !window.CompetencyWording) return;
    var title = ((document.getElementById('af-title') || /** @type {any} */ ({})).value || '').trim();
    CompetencyWording.loadBank().then(function () {
      // A rubric made from the competencies is Rubric scoring.
      if (_formMode() === 'competencies') setScoreMode('proficiency');
      var held = {
        id: uid(),
        name: _rubricNameFrom(title, 'Competency Rubric'),
        criteria: tags.map(function (tag) {
          var levels = {};
          [1, 2, 3, 4].forEach(function (l) {
            levels[l] = CompetencyWording.levelWording(tag, l).text;
          });
          return {
            id: uid(),
            name: tag.label || tag.shortName || tag.code || 'Criterion',
            tagIds: [tag.id],
            levels: levels,
            weight: 1,
            levelValues: null,
            checks: [],
          };
        }),
      };
      _holdFormRubric(held);
      _focusRubricCard('editRubricFromForm');
    });
  }

  // The Competency Rubric: the chosen competencies, a row each, with the
  // wording of every level. Only for proficiency work with no rubric.
  function _renderTagRubric() {
    var slot = document.getElementById('af-tag-rubric');
    if (!slot) return;
    var cid = pageState.activeCourse;
    var mode = (document.getElementById('af-scoremode') || /** @type {any} */ ({})).value || 'proficiency';
    var hasRubric = !!(document.getElementById('af-rubric') || /** @type {any} */ ({})).value;
    var tags = Array.from(document.querySelectorAll('.af-tag-cb:checked'))
      .map(function (cb) {
        return getTagById(cid, /** @type {any} */ (cb).value);
      })
      .filter(Boolean);
    var onCompetencies = mode === 'competencies' || (mode === 'proficiency' && !hasRubric);
    if (!onCompetencies || !tags.length || !window.CompetencyWording || !window.RubricBank) {
      slot.innerHTML = '';
      return;
    }
    var ready = true;
    var criteria = tags.map(function (tag) {
      var levels = {};
      [1, 2, 3, 4].forEach(function (l) {
        var w = CompetencyWording.levelWording(tag, l);
        if (!w.ready) ready = false;
        levels[l] = w.text;
      });
      return { id: tag.id, name: (tag.code || tag.id) + ' · ' + (tag.label || ''), tagIds: [], levels: levels };
    });
    slot.innerHTML =
      '<div class="af-rubric-card af-tag-rubric-card">' +
      '<div class="af-rubric-card-head"><span class="af-rubric-card-name">Competency Rubric</span>' +
      '<span class="af-rubric-card-meta">How each competency will be scored. The same words print on the handout.</span>' +
      '<span class="af-gap"></span>' +
      '<button type="button" class="btn btn-ghost" data-action="editMyWording">Edit My Wording</button>' +
      '<button type="button" class="btn btn-primary" data-action="useCompetencyRubric">Use This Rubric</button></div>' +
      // html-safe: RubricBank.gridHtml escapes every name and descriptor
      RubricBank.gridHtml(cid, { criteria: criteria }) +
      '<div class="af-tag-rubric-note">Your wording is used wherever these competencies appear, in every class. Use This Rubric makes it a rubric you can rename, reword just for this work, and reuse.</div>' +
      '</div>';
    if (!ready) {
      CompetencyWording.loadBank().then(function (ok) {
        if (ok) _renderTagRubric();
      });
    }
  }

  /* Edit My Wording: the four levels of each chosen competency, in the
     teacher's own words, kept in the descriptor bank (per teacher, every
     class, every later rubric and handout). */
  function editMyWording() {
    var cid = pageState.activeCourse;
    var tags = Array.from(document.querySelectorAll('.af-tag-cb:checked'))
      .map(function (cb) {
        return getTagById(cid, /** @type {any} */ (cb).value);
      })
      .filter(Boolean);
    if (!tags.length || !window.CompetencyWording || !window.RubricDraft) return;
    var html =
      '<div class="confirm-card af-wording-card" role="document">' +
      '<div class="confirm-title" id="af-wording-title">Edit My Wording</div>' +
      '<div class="confirm-message">Your wording for each level is used wherever these competencies appear, in every class: rubrics, drafts and printed handouts. Leave a level empty to use the curriculum bank’s wording.</div>' +
      '<div class="af-wording-list">';
    tags.forEach(function (tag) {
      var own = getCompetencyDescriptor(RubricDraft.competencyKey(tag)) || {};
      html +=
        '<fieldset class="af-wording-set"><legend>' +
        esc((tag.code || tag.id) + ' · ' + (tag.label || '')) +
        '</legend>';
      [4, 3, 2, 1].forEach(function (l) {
        var bank = CompetencyWording.levelWording(tag, l, true).text;
        html +=
          '<label class="af-wording-level"><span>' +
          esc(PROF_LABELS[l]) +
          '</span><textarea class="af-input" rows="2" data-tag="' +
          esc(tag.id) +
          '" data-level="' +
          l +
          '" placeholder="' +
          esc(bank) +
          '">' +
          esc(own[l] || '') +
          '</textarea></label>';
      });
      html += '</fieldset>';
    });
    html +=
      '</div><div class="confirm-actions"><button type="button" class="confirm-cancel" data-wording="cancel">Cancel</button>' +
      '<button type="button" class="confirm-ok primary" data-wording="save">Save My Wording</button></div></div>';
    var overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'af-wording-title');
    overlay.innerHTML = html; // html-safe: every value above goes through esc()
    document.body.appendChild(overlay);
    var close = function () {
      overlay.remove();
    };
    overlay.addEventListener('click', function (e) {
      var b = /** @type {any} */ (e.target).closest('[data-wording]');
      if (e.target === overlay || (b && b.dataset.wording === 'cancel')) return close();
      if (!b || b.dataset.wording !== 'save') return;
      var entries = [];
      /** @type {NodeListOf<any>} */ (overlay.querySelectorAll('textarea[data-tag]')).forEach(function (ta) {
        var tag = getTagById(cid, ta.dataset.tag);
        if (tag) entries.push({ key: RubricDraft.competencyKey(tag), level: Number(ta.dataset.level), text: ta.value });
      });
      saveCompetencyDescriptors(entries);
      close();
      _renderTagRubric();
    });
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
    var first = overlay.querySelector('textarea');
    if (first) first.focus();
  }

  /* ── The competency picker: teacher/assign-competency-picker.js ──
     Moved on 2026-11-12. Each call hands it the class on screen and the
     form helpers it uses. */
  function _cp() {
    AssignCompPicker.configure({
      activeCourse: pageState.activeCourse,
      onTagChange: onTagChange,
      _hideAfTip: _hideAfTip,
      _refreshCompHint: _refreshCompHint,
      _rubricTagIds: _rubricTagIds,
      _formChosenRubric: _formChosenRubric,
      _renderRubricView: _renderRubricView,
      _renderTagRubric: _renderTagRubric,
      _afSecTagIds: _afSecTagIds,
      _afGroupBox: _afGroupBox,
    });
    return AssignCompPicker;
  }
  function _compView() {
    return _cp()._compView();
  }
  function _compPickerOpen() {
    return _cp()._compPickerOpen();
  }
  function openCompPicker() {
    return _cp().openCompPicker();
  }
  function closeCompPicker(restore) {
    return _cp().closeCompPicker(restore);
  }
  function _removeComp(tagId) {
    return _cp()._removeComp(tagId);
  }
  function setCompView(view) {
    return _cp().setCompView(view);
  }
  function _compCounts(cid, exceptId) {
    return _cp()._compCounts(cid, exceptId);
  }
  function _compPickerHtml(cid, assess, sections, compGroups) {
    return _cp()._compPickerHtml(cid, assess, sections, compGroups);
  }
  function _syncCodes() {
    return _cp()._syncCodes();
  }
  function toggleCode(chip) {
    return _cp().toggleCode(chip);
  }
  function _tickExactly(tagIds) {
    return _cp()._tickExactly(tagIds);
  }
  function _codeHover(e) {
    return _cp()._codeHover(e);
  }
  function _compKeydown(e) {
    return _cp()._compKeydown(e);
  }
  function _compInput(e) {
    return _cp()._compInput(e);
  }

  /* Hover-overs wait for a pause (Colin, Nov 2: teachers are clicking and
     only need them when they linger). A field reached with the keyboard
     shows at once; a click's focus waits like a hover. The Codes focus box
     is not a hover-over: it follows the pointer at once. */
  var AF_HOVER_DELAY = 500;

  function _afAfterPause(el, show) {
    clearTimeout(pageState._afHoverTimer);
    pageState._afHoverTimer = setTimeout(function () {
      pageState._afHoverTimer = null;
      if (document.body.contains(el) && el.matches(':hover')) show();
    }, AF_HOVER_DELAY);
  }

  return {
    configure: configure,
    _afAfterPause: _afAfterPause,
    _askBeforeScoredChange: _askBeforeScoredChange,
    _codeHover: _codeHover,
    _compCounts: _compCounts,
    _compInput: _compInput,
    _compKeydown: _compKeydown,
    _compPickerHtml: _compPickerHtml,
    _compPickerOpen: _compPickerOpen,
    _compView: _compView,
    _removeComp: _removeComp,
    _scoredStudentCount: _scoredStudentCount,
    _syncCodes: _syncCodes,
    _tickExactly: _tickExactly,
    closeCompPicker: closeCompPicker,
    editMyWording: editMyWording,
    editRubricCopyForForm: editRubricCopyForForm,
    openCompPicker: openCompPicker,
    setCompView: setCompView,
    toggleCode: toggleCode,
    useCompetencyRubric: useCompetencyRubric,
  };
})();
