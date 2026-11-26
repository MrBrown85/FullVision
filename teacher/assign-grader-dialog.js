// @ts-check
/* assign-grader-dialog.js — The grader dialog. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignGraderDialog = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var AC,
    _SHOW_LABELS,
    _focusGraderPoints,
    _graderKeydown,
    _handleBlur,
    _handleChange,
    _handleFocus,
    _handleInput,
    _handleMouseOut,
    _handleMouseOver,
    _handlePointerDown,
    _hideChipTip,
    _loadDibelsOnce,
    _queuePrintMarks,
    pageState,
    render,
    stepFocusStudent,
    _addDocListener,
    _graderAddWorkFiles,
    _graderAfterEvent,
    _graderCaughtReturn,
    _graderGroupAction,
    _graderQueueOf,
    _graderReflectAction,
    _graderReturn,
    _graderReturnAll,
    _graderReturnNext,
    _graderRevisionAction,
    _graderSetShow,
    _graderWorkAction,
    _graderWorkEnlarge,
    _handleClick,
    _handleKeydown,
    _refreshGraderChrome,
    _reportNotePreview,
    _saveReportNote,
    _workFitSaved,
    closeGrader;
  function configure(h) {
    if ('AC' in h) AC = h.AC;
    if ('_SHOW_LABELS' in h) _SHOW_LABELS = h._SHOW_LABELS;
    if ('_focusGraderPoints' in h) _focusGraderPoints = h._focusGraderPoints;
    if ('_graderKeydown' in h) _graderKeydown = h._graderKeydown;
    if ('_handleBlur' in h) _handleBlur = h._handleBlur;
    if ('_handleChange' in h) _handleChange = h._handleChange;
    if ('_handleFocus' in h) _handleFocus = h._handleFocus;
    if ('_handleInput' in h) _handleInput = h._handleInput;
    if ('_handleMouseOut' in h) _handleMouseOut = h._handleMouseOut;
    if ('_handleMouseOver' in h) _handleMouseOver = h._handleMouseOver;
    if ('_handlePointerDown' in h) _handlePointerDown = h._handlePointerDown;
    if ('_hideChipTip' in h) _hideChipTip = h._hideChipTip;
    if ('_loadDibelsOnce' in h) _loadDibelsOnce = h._loadDibelsOnce;
    if ('_queuePrintMarks' in h) _queuePrintMarks = h._queuePrintMarks;
    if ('pageState' in h) pageState = h.pageState;
    if ('render' in h) render = h.render;
    if ('stepFocusStudent' in h) stepFocusStudent = h.stepFocusStudent;
    if ('_addDocListener' in h) _addDocListener = h._addDocListener;
    if ('_graderAddWorkFiles' in h) _graderAddWorkFiles = h._graderAddWorkFiles;
    if ('_graderAfterEvent' in h) _graderAfterEvent = h._graderAfterEvent;
    if ('_graderCaughtReturn' in h) _graderCaughtReturn = h._graderCaughtReturn;
    if ('_graderGroupAction' in h) _graderGroupAction = h._graderGroupAction;
    if ('_graderQueueOf' in h) _graderQueueOf = h._graderQueueOf;
    if ('_graderReflectAction' in h) _graderReflectAction = h._graderReflectAction;
    if ('_graderReturn' in h) _graderReturn = h._graderReturn;
    if ('_graderReturnAll' in h) _graderReturnAll = h._graderReturnAll;
    if ('_graderReturnNext' in h) _graderReturnNext = h._graderReturnNext;
    if ('_graderRevisionAction' in h) _graderRevisionAction = h._graderRevisionAction;
    if ('_graderSetShow' in h) _graderSetShow = h._graderSetShow;
    if ('_graderWorkAction' in h) _graderWorkAction = h._graderWorkAction;
    if ('_graderWorkEnlarge' in h) _graderWorkEnlarge = h._graderWorkEnlarge;
    if ('_handleClick' in h) _handleClick = h._handleClick;
    if ('_handleKeydown' in h) _handleKeydown = h._handleKeydown;
    if ('_refreshGraderChrome' in h) _refreshGraderChrome = h._refreshGraderChrome;
    if ('_reportNotePreview' in h) _reportNotePreview = h._reportNotePreview;
    if ('_saveReportNote' in h) _saveReportNote = h._saveReportNote;
    if ('_workFitSaved' in h) _workFitSaved = h._workFitSaved;
    if ('closeGrader' in h) closeGrader = h.closeGrader;
  }

  function openGrader(cid, aid, sid, opts) {
    if (pageState._grader) closeGrader();
    opts = opts || {};
    // What came in since the class was read (S6-W1); the dialog is drawn again when it changes.
    if (typeof refreshStudentWork === 'function') refreshStudentWork(cid, { force: true });
    pageState.activeCourse = cid;
    _loadDibelsOnce(cid);
    // Over this page (Grade Submissions, the Work Wall): the page's cards and
    // student, put back when the dialog closes.
    var page = opts.overPage
      ? {
          open: pageState.openAssessIds,
          focus: pageState.focusStudentId,
          expanded: pageState._allExpanded,
          collapsed: pageState._collapsedIds,
          rubricViews: pageState.rubricViewStates,
        }
      : null;
    pageState.openAssessIds = new Set([aid]);
    pageState.focusStudentId = sid;
    pageState._allExpanded = false;
    pageState._collapsedIds = new Set();
    pageState.rubricViewStates = {};
    pageState._commentPopoverState = null;
    CritComment.drop();
    pageState._kbFocusEl = null;
    pageState._statusDebounce = {};
    AC.configure(cid);
    // Over this page itself (Grade Submissions, S6-F4): its own listeners
    // are the dialog's too, and come back when the dialog closes.
    var pageListeners = pageState._listeners.slice();
    var overlay = document.createElement('div');
    overlay.id = 'grader-overlay';
    overlay.className = 'grader-overlay';
    overlay.innerHTML =
      '<div class="grader-dialog" role="dialog" aria-modal="true" aria-labelledby="grader-title" tabindex="-1"></div>';
    document.body.appendChild(overlay);
    pageState._grader = {
      overlay: overlay,
      aid: aid,
      studentIds:
        opts.studentIds && opts.studentIds.length
          ? opts.studentIds.slice()
          : sortStudents(getStudents(cid), 'lastName').map(function (s) {
              return s.id;
            }),
      // The gradebook's rows, in their order: group work steps through these.
      rowOrder: opts.studentIds && opts.studentIds.length ? opts.studentIds.slice() : null,
      onClose: opts.onClose || null,
      // The pieces that follow (I3): the Inbox's order. Ignored when the piece opened is not among them.
      queue: _graderQueueOf(opts.queue, aid),
      qi: 0,
      queueShow: opts.show && _SHOW_LABELS[opts.show] ? opts.show : 'all',
      caughtUp: false,
      pageListeners: opts.overPage ? pageListeners : null,
      page: page,
      // Show: To Grade, To Return, Returned, Not In or All (S1-F2, S6-F3).
      show: opts.show && _SHOW_LABELS[opts.show] ? opts.show : 'all',
      // The student's work beside the scoring (S6-F1): its page, the fit,
      // each page's turn, and Focus on Work.
      work: { page: 0, fit: _workFitSaved(), turns: {}, focus: false, pics: {} },
      // A reflection's answer being written, by reflection (S10-F3), the
      // one being sent, and a line about it.
      reflectDrafts: {},
      reflectBusy: null,
      reflectMsg: null,
    };
    if (pageState._grader.queue)
      pageState._grader.qi = pageState._grader.queue.findIndex(function (q) {
        return q.aid === aid;
      });
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) closeGrader();
    });
    overlay.addEventListener('click', function (e) {
      // Grade From Paper's Set Logan To menu (S6-F2): a grid row's fill options.
      var fill = /** @type {any} */ (e.target).closest('.grader-setto-menu [data-action="graderSetTo"]');
      if (fill) return _graderWorkAction('work-setto', fill);
      // Side by Side: a click on a page shows it full width, scrolled to it.
      var tile = /** @type {any} */ (e.target).closest('.grader-work-pages.fit-all .grader-work-page');
      if (tile) return _graderWorkEnlarge(tile);
      var btn = /** @type {any} */ (e.target).closest('[data-grader]');
      if (!btn) return;
      var what = btn.dataset.grader;
      if (what === 'close') closeGrader();
      else if (what === 'next' || what === 'prev') stepFocusStudent(what === 'next' ? 1 : -1);
      else if (what === 'return') _graderReturn();
      else if (what === 'return-next') _graderReturnNext();
      else if (what === 'show') _graderSetShow(btn.dataset.show);
      else if (what === 'returnAll') _graderReturnAll(btn);
      else if (what === 'caught-return') _graderCaughtReturn(btn);
      else if (what === 'caught-close') closeGrader();
      else if (what.indexOf('work-') === 0) _graderWorkAction(what, btn);
      else if (what.indexOf('reflect-') === 0) _graderReflectAction(what, btn);
      else if (what.indexOf('revision-') === 0) _graderRevisionAction(what, btn);
      else _graderGroupAction(what, btn.dataset.sid);
    });
    // Add Work's Choose Files (S6-F2).
    overlay.addEventListener('change', function (e) {
      if (/** @type {any} */ (e.target).classList.contains('grader-work-files')) _graderAddWorkFiles(e.target);
    });
    // A click anywhere but the open ⋯ menu closes it.
    overlay.addEventListener('mousedown', function (e) {
      if (
        !pageState._grader ||
        !pageState._grader.menuSid ||
        /** @type {any} */ (e.target).closest('.grader-member-menu, .grader-member-more, .grader-change-one-btn')
      )
        return;
      pageState._grader.menuSid = null;
      _refreshGraderChrome();
    });
    // The Note for the Report: the preview follows each key, the note saves
    // on Enter or leaving the box (and so before Done, a step or closing).
    overlay.addEventListener('input', function (e) {
      if (/** @type {any} */ (e.target).classList.contains('grader-report-note-input')) _reportNotePreview(e.target);
      // An answer being written is kept while the dialog redraws (S10-F3).
      if (/** @type {any} */ (e.target).classList.contains('grader-reflect-input') && pageState._grader)
        pageState._grader.reflectDrafts[/** @type {any} */ (e.target).dataset.id] = /** @type {any} */ (e.target).value;
    });
    overlay.addEventListener('change', function (e) {
      if (/** @type {any} */ (e.target).classList.contains('grader-report-note-input')) _saveReportNote(e.target);
    });
    overlay.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || !(/** @type {any} */ (e.target).classList.contains('grader-report-note-input'))) return;
      e.preventDefault();
      /** @type {any} */ (e.target).blur();
    });
    _addDocListener('click', _handleClick);
    _addDocListener('input', _handleInput);
    _addDocListener('change', _handleChange);
    _addDocListener('focus', _handleFocus, true);
    _addDocListener('mousedown', _handleFocus);
    _addDocListener('blur', _handleBlur, true);
    _addDocListener('keydown', _handleKeydown);
    _addDocListener('keydown', _graderKeydown);
    ['click', 'change', 'keyup', 'focusout'].forEach(function (type) {
      _addDocListener(type, _graderAfterEvent);
    });
    ['click', 'change', 'focusout', 'fv:rubric-prints-changed'].forEach(function (type) {
      _addDocListener(type, _queuePrintMarks);
    });
    _addDocListener('mouseover', _handleMouseOver);
    _addDocListener('mouseout', _handleMouseOut);
    _addDocListener('pointerdown', _handlePointerDown);
    _addDocListener('scroll', _hideChipTip, true);
    render();
    // Kept straight after the draw, so the first key is the dialog's; it no
    // longer scrolls, which laid the new dialog out at once (61 ms).
    /** @type {any} */ (overlay.querySelector('.grader-dialog')).focus({ preventScroll: true });
    // Points work: the box is ready to type in.
    _focusGraderPoints(aid);
  }

  return {
    configure: configure,
    openGrader: openGrader,
  };
})();
