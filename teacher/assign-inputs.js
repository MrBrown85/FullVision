// @ts-check
/* assign-inputs.js — Assignments: input, change, focus and blur handlers. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignInputs = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var _copyFromChanged,
    _formResFiles,
    _hideChipTip,
    _setFormWorkUntil,
    _setModuleDraggable,
    _showChipTip,
    _syncCodes,
    _tickGroup,
    autoSetDueDate,
    onRubricSelect,
    onTagChange,
    pageState,
    setAssessSearch,
    updateModuleName,
    _attachWorkFiles,
    _commitDibelsField,
    _graderAid,
    _graderCommitPoints,
    _graderCriterion,
    _queueOverallComment,
    _saveOverallComment,
    collabToggleStudent,
    commitPointsScore,
    getRubricCriterion,
    livePointsUpdate,
    switchCourse;
  function configure(h) {
    if ('_copyFromChanged' in h) _copyFromChanged = h._copyFromChanged;
    if ('_formResFiles' in h) _formResFiles = h._formResFiles;
    if ('_hideChipTip' in h) _hideChipTip = h._hideChipTip;
    if ('_setFormWorkUntil' in h) _setFormWorkUntil = h._setFormWorkUntil;
    if ('_setModuleDraggable' in h) _setModuleDraggable = h._setModuleDraggable;
    if ('_showChipTip' in h) _showChipTip = h._showChipTip;
    if ('_syncCodes' in h) _syncCodes = h._syncCodes;
    if ('_tickGroup' in h) _tickGroup = h._tickGroup;
    if ('autoSetDueDate' in h) autoSetDueDate = h.autoSetDueDate;
    if ('onRubricSelect' in h) onRubricSelect = h.onRubricSelect;
    if ('onTagChange' in h) onTagChange = h.onTagChange;
    if ('pageState' in h) pageState = h.pageState;
    if ('setAssessSearch' in h) setAssessSearch = h.setAssessSearch;
    if ('updateModuleName' in h) updateModuleName = h.updateModuleName;
    if ('_attachWorkFiles' in h) _attachWorkFiles = h._attachWorkFiles;
    if ('_commitDibelsField' in h) _commitDibelsField = h._commitDibelsField;
    if ('_graderAid' in h) _graderAid = h._graderAid;
    if ('_graderCommitPoints' in h) _graderCommitPoints = h._graderCommitPoints;
    if ('_graderCriterion' in h) _graderCriterion = h._graderCriterion;
    if ('_queueOverallComment' in h) _queueOverallComment = h._queueOverallComment;
    if ('_saveOverallComment' in h) _saveOverallComment = h._saveOverallComment;
    if ('collabToggleStudent' in h) collabToggleStudent = h.collabToggleStudent;
    if ('commitPointsScore' in h) commitPointsScore = h.commitPointsScore;
    if ('getRubricCriterion' in h) getRubricCriterion = h.getRubricCriterion;
    if ('livePointsUpdate' in h) livePointsUpdate = h.livePointsUpdate;
    if ('switchCourse' in h) switchCourse = h.switchCourse;
  }

  /* ── Input/change/blur handler ──────────────────────────── */
  function _handleInput(e) {
    var el = e.target;
    // The box grows with the name where field-sizing isn't supported.
    if (el.dataset.actionBlur === 'moduleName') {
      el.size = Math.max(4, el.value.length);
      return;
    }
    if (el.dataset.actionInput === 'assessSearch') {
      setAssessSearch(el.value);
      return;
    }
    // T-UI-09 · live weight mutation (mark dirty, no re-render — weight shows up
    // in the input itself, so the input's own value stays in sync).
    if (el.dataset.actionInput === 'rsgOverallComment') {
      _queueOverallComment(el);
      return;
    }
    if (el.dataset.actionInput === 'critCommentInput' || el.dataset.actionInput === 'critOwnInput') {
      CritComment.input(el);
      return;
    }
    // Points input live update
    if (el.classList.contains('gb-pts-input')) {
      livePointsUpdate(el);
      return;
    }
  }

  function _handleChange(e) {
    var el = e.target;
    if (el.dataset.action === 'assessSwitchCourse') {
      switchCourse(el.value);
      return;
    }
    if (el.dataset.actionChange === 'onRubricSelect') {
      onRubricSelect(el.value);
      return;
    }
    if (el.dataset.actionChange === 'afResFiles') {
      _formResFiles(el);
      return;
    }
    if (el.dataset.actionChange === 'attachWorkFile') {
      _attachWorkFiles(el);
      return;
    }
    if (el.dataset.actionChange === 'setFormWorkUntil') {
      _setFormWorkUntil(el);
      return;
    }
    if (el.dataset.actionChange === 'autoSetDueDate') {
      autoSetDueDate();
      return;
    }
    if (el.dataset.actionChange === 'copyFrom') {
      _copyFromChanged(el.value);
      return;
    }
    if (el.dataset.actionChange === 'tickGroup') {
      _tickGroup(el);
      return;
    }
    if (el.dataset.actionChange === 'tagCheckbox') {
      onTagChange(el, el.dataset.section);
      _syncCodes();
      return;
    }
    if (el.dataset.actionChange === 'collabToggleStudent') {
      collabToggleStudent(el.dataset.sid, el.checked);
      return;
    }
    if (el.dataset.actionChange === 'copyTargetsChanged') {
      if (window.AssessmentCopy) AssessmentCopy.onTargetsChanged();
      return;
    }
  }

  function _handleFocus(e) {
    var el = e.target;
    if (e.type === 'focus' && el && el.dataset && el.dataset.chipTip) _showChipTip(el);
    if (el && el.dataset && el.dataset.actionBlur === 'moduleName') _setModuleDraggable(el, false);
  }

  function _handleBlur(e) {
    var el = e.target;
    if (el === pageState._chipTipSource) _hideChipTip();
    if (el.dataset.actionBlur === 'moduleName') {
      // An empty name is not saved, so the box shows the saved one again.
      var saved = updateModuleName(el.dataset.moduleid, el.value);
      el.value = saved;
      el.title = saved;
      el.size = Math.max(4, saved.length);
      el.scrollLeft = 0;
      _setModuleDraggable(el, true);
      return;
    }
    if (el.dataset.actionBlur === 'graderPoints') {
      _graderCommitPoints(el, e.relatedTarget);
      return;
    }
    if (el.dataset.actionBlur === 'graderCritNote') {
      var noteAid = _graderAid(el);
      var text = el.value.trim();
      if (!noteAid || !pageState.focusStudentId) return;
      if (
        text !==
        getRubricCriterionComment(
          pageState.activeCourse,
          pageState.focusStudentId,
          noteAid,
          _graderCriterion(noteAid, el.dataset.critid),
        )
      )
        Grader.setCriterionComment(pageState.activeCourse, pageState.focusStudentId, noteAid, el.dataset.critid, text);
      el.classList.toggle('has-text', !!text);
      return;
    }
    if (el.dataset.actionBlur === 'dibelsField') {
      if (el.isConnected) _commitDibelsField(el);
      return;
    }
    if (el.dataset.actionBlur === 'rsgOverallComment') {
      CritComment.flowBlur(el);
      _saveOverallComment(el);
      return;
    }
    if (el.dataset.actionBlur === 'critCommentBlur') {
      CritComment.save();
      return;
    }
    if (el.dataset.actionBlur === 'rsgWorkOn' || el.dataset.actionBlur === 'rsgBeyond') {
      var spCrit = getRubricCriterion(el.dataset.aid, el.dataset.critid);
      if (!spCrit || !el.isConnected) return;
      var spText = el.value.trim();
      var beyond = el.dataset.actionBlur === 'rsgBeyond';
      var spSaved = beyond
        ? getRubricCriterionBeyond(pageState.activeCourse, el.dataset.sid, el.dataset.aid, spCrit)
        : getRubricCriterionComment(pageState.activeCourse, el.dataset.sid, el.dataset.aid, spCrit);
      if (spText === spSaved) return;
      if (beyond)
        Grader.setWentBeyond(pageState.activeCourse, el.dataset.sid, el.dataset.aid, el.dataset.critid, spText);
      else
        Grader.setCriterionComment(pageState.activeCourse, el.dataset.sid, el.dataset.aid, el.dataset.critid, spText);
      return;
    }
    if (el.dataset.actionBlur === 'graderCritBeyond') {
      var beyondAid = _graderAid(el);
      var beyondText = el.value.trim();
      if (!beyondAid || !pageState.focusStudentId) return;
      if (
        beyondText !==
        getRubricCriterionBeyond(
          pageState.activeCourse,
          pageState.focusStudentId,
          beyondAid,
          _graderCriterion(beyondAid, el.dataset.critid),
        )
      )
        Grader.setWentBeyond(
          pageState.activeCourse,
          pageState.focusStudentId,
          beyondAid,
          el.dataset.critid,
          beyondText,
        );
      el.classList.toggle('has-text', !!beyondText);
      return;
    }
    if (el.dataset.actionBlur === 'graderTagNote') {
      var tagAid = _graderAid(el);
      var tagText = el.value.trim();
      if (!tagAid || !pageState.focusStudentId) return;
      if (tagText !== getTagComment(pageState.activeCourse, pageState.focusStudentId, tagAid, el.dataset.tag))
        Grader.setCompetencyComment(pageState.activeCourse, pageState.focusStudentId, tagAid, el.dataset.tag, tagText);
      el.classList.toggle('has-text', !!tagText);
      return;
    }
    // Points input commit on blur. A re-render that removes the input also
    // blurs it; that is not the teacher leaving the field.
    if (el.classList.contains('gb-pts-input')) {
      if (!el.isConnected) return;
      commitPointsScore(el);
      return;
    }
  }

  return {
    configure: configure,
    _handleBlur: _handleBlur,
    _handleChange: _handleChange,
    _handleFocus: _handleFocus,
    _handleInput: _handleInput,
  };
})();
