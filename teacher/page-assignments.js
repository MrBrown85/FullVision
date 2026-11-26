/* ── page-assignments.js — Assignments page module ─────────── */
window.PageAssignments = (function () {
  'use strict';

  /* What this file holds while its page is open: every variable that is
     assigned again as the teacher works. One object, so a part of this
     file that moves to its own file can be handed it once. */
  var pageState = {};
  /* In assign-cards.js (moved 2026-11-26). */
  var _CHEVRON_ICON = AssignCards._CHEVRON_ICON;
  var _MODULE_CHEVRON = AssignCards._MODULE_CHEVRON;
  var _MODULE_TRASH = AssignCards._MODULE_TRASH;
  var _RUBRIC_ICON = AssignCards._RUBRIC_ICON;
  var _WARNING_ICON = AssignCards._WARNING_ICON;
  var _getAssessmentCategoryId = AssignCards._getAssessmentCategoryId;
  var _getCategoryName = AssignCards._getCategoryName;
  var _getSortedCategories = AssignCards._getSortedCategories;
  var _returnState = AssignCards._returnState;
  var _singlePointHtml = AssignCards._singlePointHtml;
  var _toolbarState = AssignCards._toolbarState;
  var renderAssessToolbar = AssignCards.renderAssessToolbar;
  var setAssessSearch = AssignCards.setAssessSearch;
  var sortAssessmentsForList = AssignCards.sortAssessmentsForList;
  var toggleCategoryFilter = AssignCards.toggleCategoryFilter;
  /* In assign-card-list.js (moved 2026-11-26). */
  var _criterionState = AssignCardList._criterionState;
  var _graderHtml = AssignCardList._graderHtml;
  var _graderNotesOpen = AssignCardList._graderNotesOpen;
  var _scoreTagObjs = AssignCardList._scoreTagObjs;
  /* In assign-focus.js (moved 2026-11-26). */
  var _focusGraderPoints = AssignFocus._focusGraderPoints;
  var _graderToTop = AssignFocus._graderToTop;
  var _scrollIntoViewIfNeeded = AssignFocus._scrollIntoViewIfNeeded;
  var clearFocusStudent = AssignFocus.clearFocusStudent;
  var stepFocusStudent = AssignFocus.stepFocusStudent;
  var toggleFocusStudent = AssignFocus.toggleFocusStudent;
  /* In assign-modules.js (moved 2026-11-26). */
  var _canStack = AssignModules._canStack;
  var _clearDropMarker = AssignModules._clearDropMarker;
  var _clearMergeState = AssignModules._clearMergeState;
  var _moduleNameSaved = AssignModules._moduleNameSaved;
  var _setDropMarker = AssignModules._setDropMarker;
  var _setModuleDraggable = AssignModules._setModuleDraggable;
  var addModuleInline = AssignModules.addModuleInline;
  var deleteModule = AssignModules.deleteModule;
  var mergeToNewModule = AssignModules.mergeToNewModule;
  var onAssessDragEnd = AssignModules.onAssessDragEnd;
  var onAssessDragStart = AssignModules.onAssessDragStart;
  var onFolderDrop = AssignModules.onFolderDrop;
  var onModuleDragEnd = AssignModules.onModuleDragEnd;
  var onModuleDragStart = AssignModules.onModuleDragStart;
  var onModuleDropZoneDrop = AssignModules.onModuleDropZoneDrop;
  var openModuleColorPop = AssignModules.openModuleColorPop;
  var reorderAssessment = AssignModules.reorderAssessment;
  var toggleModuleFolder = AssignModules.toggleModuleFolder;
  var updateModuleName = AssignModules.updateModuleName;
  /* In assign-rubric-editor.js (moved 2026-11-26). */
  var _RUBRIC_STYLE_NAMES = AssignRubricEditor._RUBRIC_STYLE_NAMES;
  var _closeRubricModal = AssignRubricEditor._closeRubricModal;
  var _openRubricModal = AssignRubricEditor._openRubricModal;
  var _renderRubricModal = AssignRubricEditor._renderRubricModal;
  var _saveModalRubric = AssignRubricEditor._saveModalRubric;
  var deleteRubricUI = AssignRubricEditor.deleteRubricUI;
  var editRubricUI = AssignRubricEditor.editRubricUI;
  var newRubricUI = AssignRubricEditor.newRubricUI;
  var openRubricBank = AssignRubricEditor.openRubricBank;
  /* In assign-rubric-criteria.js (moved 2026-11-26). */
  var _dropBlankChecks = AssignRubricCriteria._dropBlankChecks;
  var _whenWordingLoaded = AssignRubricCriteria._whenWordingLoaded;
  var cancelRubricEdit = AssignRubricCriteria.cancelRubricEdit;
  var newRubricFromForm = AssignRubricCriteria.newRubricFromForm;
  var rubricFromClass = AssignRubricCriteria.rubricFromClass;
  var saveRubricEdit = AssignRubricCriteria.saveRubricEdit;
  /* In assign-past.js (moved 2026-11-26). */
  var _formKeepForNext = AssignPast._formKeepForNext;
  var _holdFormRubric = AssignPast._holdFormRubric;
  var _pastClassName = AssignPast._pastClassName;
  var _reopenWith = AssignPast._reopenWith;
  var deleteAssess = AssignPast.deleteAssess;
  var dupeAssess = AssignPast.dupeAssess;
  var editAssess = AssignPast.editAssess;
  var saveEditAssess = AssignPast.saveEditAssess;
  var startFromPast = AssignPast.startFromPast;
  /* In assign-crud.js (moved 2026-11-26). */
  var _cardHas = AssignCrud._cardHas;
  var _formDialog = AssignCrud._formDialog;
  var _newQuizBtn = AssignCrud._newQuizBtn;
  var _persistPendingFormRubric = AssignCrud._persistPendingFormRubric;
  var _quizOn = AssignCrud._quizOn;
  var cancelAssessForm = AssignCrud.cancelAssessForm;
  var hideNewForm = AssignCrud.hideNewForm;
  var onTagChange = AssignCrud.onTagChange;
  var showNewForm = AssignCrud.showNewForm;
  var toggleSectionTags = AssignCrud.toggleSectionTags;
  var updateSectionBadge = AssignCrud.updateSectionBadge;
  /* In assign-copy-class-view.js (moved 2026-11-26). */
  var _afAfterPause = AssignCopyClassView._afAfterPause;
  var _askBeforeScoredChange = AssignCopyClassView._askBeforeScoredChange;
  var _codeHover = AssignCopyClassView._codeHover;
  var _compCounts = AssignCopyClassView._compCounts;
  var _compInput = AssignCopyClassView._compInput;
  var _compKeydown = AssignCopyClassView._compKeydown;
  var _compPickerHtml = AssignCopyClassView._compPickerHtml;
  var _compPickerOpen = AssignCopyClassView._compPickerOpen;
  var _compView = AssignCopyClassView._compView;
  var _removeComp = AssignCopyClassView._removeComp;
  var _scoredStudentCount = AssignCopyClassView._scoredStudentCount;
  var _syncCodes = AssignCopyClassView._syncCodes;
  var _tickExactly = AssignCopyClassView._tickExactly;
  var closeCompPicker = AssignCopyClassView.closeCompPicker;
  var editMyWording = AssignCopyClassView.editMyWording;
  var editRubricCopyForForm = AssignCopyClassView.editRubricCopyForForm;
  var openCompPicker = AssignCopyClassView.openCompPicker;
  var setCompView = AssignCopyClassView.setCompView;
  var toggleCode = AssignCopyClassView.toggleCode;
  var useCompetencyRubric = AssignCopyClassView.useCompetencyRubric;
  /* In assign-copy-class.js (moved 2026-11-26). */
  var _copyCardHtml = AssignCopyClass._copyCardHtml;
  var _copyFromChanged = AssignCopyClass._copyFromChanged;
  var _copyLoad = AssignCopyClass._copyLoad;
  var _copySources = AssignCopyClass._copySources;
  var _copyUse = AssignCopyClass._copyUse;
  var _lastUsedRubric = AssignCopyClass._lastUsedRubric;
  var _useRubricInForm = AssignCopyClass._useRubricInForm;
  var cancelRubricPick = AssignCopyClass.cancelRubricPick;
  var chooseRubric = AssignCopyClass.chooseRubric;
  var editRubricFromForm = AssignCopyClass.editRubricFromForm;
  var rubricsListCount = AssignCopyClass.rubricsListCount;
  /* In assign-blank-rubric.js (moved 2026-11-26). */
  var _blankAct = AssignBlankRubric._blankAct;
  var _blankCardHtml = AssignBlankRubric._blankCardHtml;
  var _blankInput = AssignBlankRubric._blankInput;
  var _blankOutside = AssignBlankRubric._blankOutside;
  var _blankPickerKey = AssignBlankRubric._blankPickerKey;
  var _blankRender = AssignBlankRubric._blankRender;
  var _blankSizeCells = AssignBlankRubric._blankSizeCells;
  var _blankState = AssignBlankRubric._blankState;
  var _blankWritten = AssignBlankRubric._blankWritten;
  var _cancelBlank = AssignBlankRubric._cancelBlank;
  var _commitOpenBlank = AssignBlankRubric._commitOpenBlank;
  var _newBlankDraft = AssignBlankRubric._newBlankDraft;
  var _rubricNameFrom = AssignBlankRubric._rubricNameFrom;
  /* In assign-form-rubric.js (moved 2026-11-26). */
  var _focusRubricCard = AssignFormRubric._focusRubricCard;
  var _renderRubricView = AssignFormRubric._renderRubricView;
  var _rubricCodes = AssignFormRubric._rubricCodes;
  var _startKeydown = AssignFormRubric._startKeydown;
  var _startPickNone = AssignFormRubric._startPickNone;
  var _startPickRow = AssignFormRubric._startPickRow;
  var _startPickUse = AssignFormRubric._startPickUse;
  var _startSearch = AssignFormRubric._startSearch;
  var closeStart = AssignFormRubric.closeStart;
  var openStart = AssignFormRubric.openStart;
  /* In assign-form-checks.js (moved 2026-11-26). */
  var _formAssessWeight = AssignFormChecks._formAssessWeight;
  var _formChanges = AssignFormChecks._formChanges;
  var _formChosenRubric = AssignFormChecks._formChosenRubric;
  var _formEscape = AssignFormChecks._formEscape;
  var _formInput = AssignFormChecks._formInput;
  var _formKeydown = AssignFormChecks._formKeydown;
  var _formMaxPoints = AssignFormChecks._formMaxPoints;
  var _formMaxPointsOk = AssignFormChecks._formMaxPointsOk;
  var _markFormStart = AssignFormChecks._markFormStart;
  var _refreshUntaggedNote = AssignFormChecks._refreshUntaggedNote;
  var _rubricTagIds = AssignFormChecks._rubricTagIds;
  var _syncMaxPointsPicks = AssignFormChecks._syncMaxPointsPicks;
  var _untaggedNote = AssignFormChecks._untaggedNote;
  var onRubricSelect = AssignFormChecks.onRubricSelect;
  /* In assign-form-helpers.js (moved 2026-11-26). */
  var COMPETENCIES_NEED_TAG_HINT = AssignFormHelpers.COMPETENCIES_NEED_TAG_HINT;
  var DUE_BEFORE_ASSIGNED_HINT = AssignFormHelpers.DUE_BEFORE_ASSIGNED_HINT;
  var SCORE_MODE_CARDS = AssignFormHelpers.SCORE_MODE_CARDS;
  var _countsAsAfterEvent = AssignFormHelpers._countsAsAfterEvent;
  var _countsAsText = AssignFormHelpers._countsAsText;
  var _dueBeforeAssigned = AssignFormHelpers._dueBeforeAssigned;
  var _formCategoryChosen = AssignFormHelpers._formCategoryChosen;
  var _formCompetencyTagged = AssignFormHelpers._formCompetencyTagged;
  var _formMode = AssignFormHelpers._formMode;
  var _formModeOf = AssignFormHelpers._formModeOf;
  var _lastScoreMode = AssignFormHelpers._lastScoreMode;
  var _refreshCategoryHint = AssignFormHelpers._refreshCategoryHint;
  var _refreshCompHint = AssignFormHelpers._refreshCompHint;
  var _refreshCountsToward = AssignFormHelpers._refreshCountsToward;
  var _refreshDueHint = AssignFormHelpers._refreshDueHint;
  var _storedScoreMode = AssignFormHelpers._storedScoreMode;
  var _weekAfter = AssignFormHelpers._weekAfter;
  var autoSetDueDate = AssignFormHelpers.autoSetDueDate;
  var setScoreMode = AssignFormHelpers.setScoreMode;
  /* In assign-form-work.js (moved 2026-11-26). */
  var RES_LINK_WORDS = AssignFormWork.RES_LINK_WORDS;
  var _afterDueRowHtml = AssignFormWork._afterDueRowHtml;
  var _formResAddLink = AssignFormWork._formResAddLink;
  var _formResBusy = AssignFormWork._formResBusy;
  var _formResChanged = AssignFormWork._formResChanged;
  var _formResCloseLink = AssignFormWork._formResCloseLink;
  var _formResFiles = AssignFormWork._formResFiles;
  var _formResFor = AssignFormWork._formResFor;
  var _formResHtml = AssignFormWork._formResHtml;
  var _formResKeydown = AssignFormWork._formResKeydown;
  var _formResOffered = AssignFormWork._formResOffered;
  var _formResOpenLink = AssignFormWork._formResOpenLink;
  var _formResRemove = AssignFormWork._formResRemove;
  var _formResSnapshot = AssignFormWork._formResSnapshot;
  var _formWorkCardHtml = AssignFormWork._formWorkCardHtml;
  var _formWorkDemo = AssignFormWork._formWorkDemo;
  var _formWorkFor = AssignFormWork._formWorkFor;
  var _formWorkOffered = AssignFormWork._formWorkOffered;
  var _formWorkUntilDefault = AssignFormWork._formWorkUntilDefault;
  var _refreshFormWorkCard = AssignFormWork._refreshFormWorkCard;
  var _refreshWorkPeek = AssignFormWork._refreshWorkPeek;
  var _saveFormRes = AssignFormWork._saveFormRes;
  var _saveFormWork = AssignFormWork._saveFormWork;
  var _setFormWork = AssignFormWork._setFormWork;
  var _setFormWorkUntil = AssignFormWork._setFormWorkUntil;
  /* In assign-form.js (moved 2026-11-26). */
  var renderAssessForm = AssignForm.renderAssessForm;
  /* In assign-form-tips.js (moved 2026-11-26). */
  var _afGroupBox = AssignFormTips._afGroupBox;
  var _afSecTagIds = AssignFormTips._afSecTagIds;
  var _afTipBlur = AssignFormTips._afTipBlur;
  var _afTipChange = AssignFormTips._afTipChange;
  var _afTipFocus = AssignFormTips._afTipFocus;
  var _afTipOut = AssignFormTips._afTipOut;
  var _afTipOver = AssignFormTips._afTipOver;
  var _afTipScroll = AssignFormTips._afTipScroll;
  var _afterCardsDrawn = AssignFormTips._afterCardsDrawn;
  var _cardScoringBadges = AssignFormTips._cardScoringBadges;
  var _categoryChipTip = AssignFormTips._categoryChipTip;
  var _chipTipAttrs = AssignFormTips._chipTipAttrs;
  var _hasNameTip = AssignFormTips._hasNameTip;
  var _hideAfTip = AssignFormTips._hideAfTip;
  var _hideChipTip = AssignFormTips._hideChipTip;
  var _queueNameTip = AssignFormTips._queueNameTip;
  var _showChipTip = AssignFormTips._showChipTip;
  var _tickGroup = AssignFormTips._tickGroup;
  var render = AssignFormTips.render;
  AssignFormTips.configure({
    pageState: pageState,
    _afAfterPause: _afAfterPause,
    _byKeyboard: _byKeyboard,
    _compCounts: _compCounts,
    _getAssessmentCategoryId: _getAssessmentCategoryId,
    _holdsGrades: _holdsGrades,
    _loadDibelsOnce: _loadDibelsOnce,
    _newFormHtml: _newFormHtml,
    _refreshClassResultsSoon: _refreshClassResultsSoon,
    _renderGrader: _renderGrader,
    _returnShownIds: _returnShownIds,
    _seedReturns: _seedReturns,
    _syncCodes: _syncCodes,
    refreshLedgerSummary: refreshLedgerSummary,
    renderAssessToolbar: renderAssessToolbar,
    renderAssessmentList: renderAssessmentList,
    sortAssessmentsForList: sortAssessmentsForList,
  });
  AssignForm.configure({
    pageState: pageState,
    _compPickerHtml: _compPickerHtml,
    _compView: _compView,
    _dueBeforeAssigned: _dueBeforeAssigned,
    _formModeOf: _formModeOf,
    _formResFor: _formResFor,
    _formResHtml: _formResHtml,
    _formResOffered: _formResOffered,
    _formWorkCardHtml: _formWorkCardHtml,
    _formWorkFor: _formWorkFor,
    _formWorkOffered: _formWorkOffered,
    _getAssessmentCategoryId: _getAssessmentCategoryId,
    _getSortedCategories: _getSortedCategories,
    _lastScoreMode: _lastScoreMode,
    _scoredStudentCount: _scoredStudentCount,
    _storedScoreMode: _storedScoreMode,
    _studentPageOn: _studentPageOn,
    _untaggedNote: _untaggedNote,
    _afGroupBox: _afGroupBox,
  });
  AssignFormWork.configure({ pageState: pageState, _studentPageOn: _studentPageOn, _weekAfter: _weekAfter });
  AssignFormHelpers.configure({
    pageState: pageState,
    _blankWritten: _blankWritten,
    _formAssessWeight: _formAssessWeight,
    _syncCodes: _syncCodes,
  });
  AssignFormChecks.configure({
    pageState: pageState,
    _compPickerOpen: _compPickerOpen,
    _syncCodes: _syncCodes,
    cancelAssessForm: cancelAssessForm,
    updateSectionBadge: updateSectionBadge,
    _formResSnapshot: _formResSnapshot,
    _hideAfTip: _hideAfTip,
    _refreshDueHint: _refreshDueHint,
    _refreshFormWorkCard: _refreshFormWorkCard,
    _refreshWorkPeek: _refreshWorkPeek,
  });
  AssignFormRubric.configure({
    pageState: pageState,
    _blankCardHtml: _blankCardHtml,
    _blankPickerKey: _blankPickerKey,
    _blankRender: _blankRender,
    _blankSizeCells: _blankSizeCells,
    _blankState: _blankState,
    _blankWritten: _blankWritten,
    _copyCardHtml: _copyCardHtml,
    _copyLoad: _copyLoad,
    _copySources: _copySources,
    _copyUse: _copyUse,
    _lastUsedRubric: _lastUsedRubric,
    _newBlankDraft: _newBlankDraft,
    _scrollIntoViewIfNeeded: _scrollIntoViewIfNeeded,
    _useRubricInForm: _useRubricInForm,
    rubricsListCount: rubricsListCount,
  });
  AssignBlankRubric.configure({
    pageState: pageState,
    _askBeforeScoredChange: _askBeforeScoredChange,
    _closeRubricModal: _closeRubricModal,
    _dropBlankChecks: _dropBlankChecks,
    _formDialog: _formDialog,
    _holdFormRubric: _holdFormRubric,
    _renderRubricModal: _renderRubricModal,
    _saveModalRubric: _saveModalRubric,
    _renderRubricView: _renderRubricView,
    closeStart: closeStart,
  });
  AssignCopyClass.configure({
    pageState: pageState,
    _askBeforeScoredChange: _askBeforeScoredChange,
    _formDialog: _formDialog,
    _holdFormRubric: _holdFormRubric,
    _pastClassName: _pastClassName,
    _scoredStudentCount: _scoredStudentCount,
    editRubricCopyForForm: editRubricCopyForForm,
    editRubricUI: editRubricUI,
    _blankState: _blankState,
    _focusRubricCard: _focusRubricCard,
    _renderRubricView: _renderRubricView,
    _rubricCodes: _rubricCodes,
    onRubricSelect: onRubricSelect,
    openStart: openStart,
  });
  AssignCopyClassView.configure({
    pageState: pageState,
    _formDialog: _formDialog,
    _holdFormRubric: _holdFormRubric,
    _openRubricModal: _openRubricModal,
    onTagChange: onTagChange,
    _afGroupBox: _afGroupBox,
    _afSecTagIds: _afSecTagIds,
    _focusRubricCard: _focusRubricCard,
    _formChosenRubric: _formChosenRubric,
    _formMode: _formMode,
    _hideAfTip: _hideAfTip,
    _refreshCompHint: _refreshCompHint,
    _renderRubricView: _renderRubricView,
    _rubricNameFrom: _rubricNameFrom,
    _rubricTagIds: _rubricTagIds,
    _storedScoreMode: _storedScoreMode,
    setScoreMode: setScoreMode,
  });
  AssignCrud.configure({
    pageState: pageState,
    _resetCollabState: _resetCollabState,
    _studentPageOn: _studentPageOn,
    renderCollabPanel: renderCollabPanel,
    _blankWritten: _blankWritten,
    _formChanges: _formChanges,
    _hideAfTip: _hideAfTip,
    _markFormStart: _markFormStart,
    _refreshCountsToward: _refreshCountsToward,
    _refreshUntaggedNote: _refreshUntaggedNote,
    _syncCodes: _syncCodes,
    renderAssessForm: renderAssessForm,
  });
  AssignPast.configure({
    pageState: pageState,
    _getAssessmentCategoryId: _getAssessmentCategoryId,
    loadCollabData: loadCollabData,
    renderCollabPanel: renderCollabPanel,
    _commitOpenBlank: _commitOpenBlank,
    _formAssessWeight: _formAssessWeight,
    _formCategoryChosen: _formCategoryChosen,
    _formChanges: _formChanges,
    _formCompetencyTagged: _formCompetencyTagged,
    _formMaxPoints: _formMaxPoints,
    _formMaxPointsOk: _formMaxPointsOk,
    _formModeOf: _formModeOf,
    _formResBusy: _formResBusy,
    _markFormStart: _markFormStart,
    _persistPendingFormRubric: _persistPendingFormRubric,
    _refreshCategoryHint: _refreshCategoryHint,
    _refreshCountsToward: _refreshCountsToward,
    _refreshDueHint: _refreshDueHint,
    _saveFormRes: _saveFormRes,
    _saveFormWork: _saveFormWork,
    _syncCodes: _syncCodes,
    _syncMaxPointsPicks: _syncMaxPointsPicks,
    _tickExactly: _tickExactly,
    _useRubricInForm: _useRubricInForm,
    autoSetDueDate: autoSetDueDate,
    hideNewForm: hideNewForm,
    onRubricSelect: onRubricSelect,
    render: render,
    renderAssessForm: renderAssessForm,
    setScoreMode: setScoreMode,
    showNewForm: showNewForm,
  });
  AssignRubricCriteria.configure({
    pageState: pageState,
    _cancelBlank: _cancelBlank,
    _holdFormRubric: _holdFormRubric,
    _syncCodes: _syncCodes,
    onRubricSelect: onRubricSelect,
    openStart: openStart,
    render: render,
  });
  AssignRubricEditor.configure({
    pageState: pageState,
    openCopyIn: openCopyIn,
    _blankCardHtml: _blankCardHtml,
    _blankSizeCells: _blankSizeCells,
    _blankState: _blankState,
    _newBlankDraft: _newBlankDraft,
    _renderRubricView: _renderRubricView,
    _useRubricInForm: _useRubricInForm,
    _whenWordingLoaded: _whenWordingLoaded,
    render: render,
    saveRubricEdit: saveRubricEdit,
    setScoreMode: setScoreMode,
    showNewForm: showNewForm,
  });
  AssignModules.configure({
    pageState: pageState,
    _saveClosedModules: _saveClosedModules,
    sortAssessmentsForList: sortAssessmentsForList,
    render: render,
  });
  AssignFocus.configure({
    pageState: pageState,
    _graderAid: _graderAid,
    _graderHideCaughtUp: _graderHideCaughtUp,
    _graderQueueStep: _graderQueueStep,
    _graderRoot: _graderRoot,
    _graderStepGroup: _graderStepGroup,
    _graderStepShown: _graderStepShown,
    kbFocusCell: kbFocusCell,
    render: render,
  });
  AssignCardList.configure({
    pageState: pageState,
    _checklistAdvice: _checklistAdvice,
    _checklistKey: _checklistKey,
    _completeCardHtml: _completeCardHtml,
    _dibelsCardHtml: _dibelsCardHtml,
    _dibelsGridHtml: _dibelsGridHtml,
    _graderOverallCommentHtml: _graderOverallCommentHtml,
    _graderPickHtml: _graderPickHtml,
    _isAdvancedRubric: _isAdvancedRubric,
    _isChecklistOpen: _isChecklistOpen,
    _levelCardsHtml: _levelCardsHtml,
    _pointsCardHtml: _pointsCardHtml,
    _singlePointHtml: _singlePointHtml,
    _sixButtonsHtml: _sixButtonsHtml,
    _sixChecklistAdvice: _sixChecklistAdvice,
    _sixChecklistColsHtml: _sixChecklistColsHtml,
    renderCompletionGrid: renderCompletionGrid,
    renderPointsGrid: renderPointsGrid,
    renderRubricGradingView: renderRubricGradingView,
    renderTagGrid: renderTagGrid,
  });
  AssignCards.configure({
    pageState: pageState,
    _expandSegOn: _expandSegOn,
    _graderPickHtml: _graderPickHtml,
    _holdsGrades: _holdsGrades,
    _criterionState: _criterionState,
    _quizOn: _quizOn,
    render: render,
  });

  /* ── Listener tracking for cleanup ──────────────────────── */
  pageState._listeners = [];
  function _addDocListener(type, handler, options) {
    document.addEventListener(type, handler, options);
    pageState._listeners.push({ type: type, handler: handler, options: options });
  }

  /* ── State variables ────────────────────────────────────── */
  pageState.activeCourse = undefined;
  pageState.openAssessIds = new Set();
  pageState.focusStudentParam = null;
  pageState._allExpanded = true;
  pageState._collapsedIds = new Set();
  pageState.filterCategories = [];
  pageState.assessSearch = '';
  pageState.showUngraded = false;
  // "N to return" pressed: only the assessments with a draft (S1-F2).
  pageState._toReturnOnly = false;
  // The drafts on screen, summed over the listed assessments at the last
  // render or refresh.
  pageState._toReturnTotal = 0;
  pageState.rubricViewStates = {};
  // Advanced Rubric checklists open under their criterion rows, keyed
  // aid:sid:critId. In All mode every one is open except those closed.
  var _openChecklists = new Set();
  var _closedChecklists = new Set();
  // Checklists: Show | Hide on Advanced rubrics (decision 2, Oct 27): Show
  // opens every checklist, Hide closes them; a row's ☑ opens or closes one.
  var CHECKLIST_MODE_KEY = 'rsg-checklists';
  pageState._showingNewForm = false;
  pageState._editingAssessId = null;
  pageState.collapsedModules = {};
  // While a search or filter is on, every module with matches shows open;
  // a module the teacher closes during it is kept here, not saved.
  pageState._filterClosedModules = {};
  // Closed modules stay closed per class, saved with the teacher's
  // preferences so they survive signing out. This key is the old
  // browser-only copy, read once when a class has nothing saved yet.
  var MODULES_CLOSED_KEY = 'gb-assign-modules-closed-';
  pageState._dragAssessId = null;
  pageState._dragModuleId = null;
  pageState._dragSid = null;
  pageState._dragFromGroup = null;
  pageState._mergeTargetId = null;
  pageState._mergeHoverTimer = null;
  pageState._mergeAnimating = false;
  pageState.focusStudentId = null;
  pageState._searchTimer = null;
  // Collaboration delegation (now in assign-collab.js)
  var AC = AssignCollab;
  AssignPast.configure({ AC: AC });
  AssignFormWork.configure({ AC: AC });
  pageState.newCollaboration = undefined; // alias for reads in save logic
  pageState.collabExcluded = undefined;
  pageState.collabPairs = undefined;
  pageState.collabGroups = undefined;
  pageState.collabGroupCount = undefined;
  function _syncCollabState() {
    pageState.newCollaboration = AC.collaboration;
    pageState.collabExcluded = AC.excluded;
    pageState.collabPairs = AC.pairs;
    pageState.collabGroups = AC.groups;
    pageState.collabGroupCount = AC.groupCount;
  }
  function setCollaboration(mode) {
    AC.setCollaboration(mode);
    _syncCollabState();
    // Who Sends the Work? shows only for pairs and groups.
    _refreshFormWorkCard();
  }
  function renderCollabPanel() {
    AC.renderCollabPanel();
    // The form is in the page now: Student Work can read its due date and title.
    _refreshFormWorkCard();
  }
  function collabToggleStudent(sid, checked) {
    AC.collabToggleStudent(sid, checked);
    _refreshWorkPeek();
  }
  function collabCheckAll() {
    AC.collabCheckAll();
    _refreshWorkPeek();
  }
  function collabCheckNone() {
    AC.collabCheckNone();
    _refreshWorkPeek();
  }
  function collabRandomPairs() {
    AC.collabRandomPairs();
    _syncCollabState();
  }
  function collabRandomGroups() {
    AC.collabRandomGroups();
    _syncCollabState();
  }
  function collabManualPairs() {
    AC.collabManualPairs();
    _syncCollabState();
  }
  function collabManualGroups() {
    AC.collabManualGroups();
    _syncCollabState();
  }
  function collabSetGroupCount(delta) {
    AC.collabSetGroupCount(delta);
    _syncCollabState();
  }
  function collabDragStart(e, sid, fromGroup) {
    AC.collabDragStart(e, sid, fromGroup);
  }
  function collabDrop(e, toGroup) {
    AC.collabDrop(e, toGroup);
    _syncCollabState();
  }
  function loadCollabData(assess) {
    AC.loadCollabData(assess);
    _syncCollabState();
  }
  function _resetCollabState() {
    AC.resetState();
    _syncCollabState();
  }

  // Rubric editor state
  pageState._editingRubric = null;
  // A rubric made from the assessment form (blank, drafted or a copy) waits
  // here, unsaved, until the assessment is created (redesign PR 8).
  pageState._pendingFormRubric = null;
  // Scores to move to a copied rubric once the edit is saved (PR 10).
  pageState._scoreMoveAfterSave = null;
  pageState._rubricDirty = false;
  // The rubric as saved and its scored-student counts, for the edit guard.
  pageState._rubricBefore = null;
  pageState._rubricScored = {};
  pageState._rubricAutoTags = [];

  // Comment popover state
  pageState._commentPopoverState = null;

  // Keyboard navigation state
  pageState._kbFocusEl = null;

  // Status debounce
  pageState._statusDebounce = {};

  // Module colors
  var MODULE_COLORS = [
    '#6366f1',
    '#06b6d4',
    '#10b981',
    '#f59e0b',
    '#ef4444',
    '#8b5cf6',
    '#ec4899',
    '#14b8a6',
    '#f97316',
    '#64748b',
  ];
  AssignModules.configure({ MODULE_COLORS: MODULE_COLORS });
  var SECTION_COLORS = ['#3b82f6', '#0891b2', '#059669', '#9333ea', '#dc2626', '#ea580c', '#0284c7', '#4f46e5'];

  function _loadClosedModules(cid) {
    var byClass = getDashboardPrefs().closedModules || {};
    if (Array.isArray(byClass[cid])) {
      var closed = {};
      byClass[cid].forEach(function (id) {
        closed[id] = true;
      });
      return closed;
    }
    try {
      var saved = JSON.parse(localStorage.getItem(MODULES_CLOSED_KEY + cid) || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch (e) {
      return {};
    }
  }

  function _saveClosedModules() {
    var ids = Object.keys(pageState.collapsedModules).filter(function (id) {
      return pageState.collapsedModules[id];
    });
    var byClass = Object.assign({}, getDashboardPrefs().closedModules || {});
    byClass[pageState.activeCourse] = ids;
    var picked = {};
    picked[pageState.activeCourse] = true;
    saveDashboardPrefs({ closedModules: byClass }, { closedModules: picked });
  }

  /* ── switchCourse ───────────────────────────────────────── */
  async function switchCourse(cid) {
    pageState.activeCourse = cid;
    if (!(await switchActiveCourse(cid))) return;
    pageState.filterCategories = [];
    pageState.assessSearch = '';
    pageState.showUngraded = false;
    AssignShow.reset();
    AssignToolbar.reset();
    pageState.focusStudentId = null;
    pageState.collapsedModules = _loadClosedModules(cid);
    pageState.rubricViewStates = {};
    // The roster's grades are the year so far, as on the Gradebook.
    if (typeof setActiveTerm === 'function') setActiveTerm(pageState.activeCourse, null);
    document.getElementById('sidebar-mount').innerHTML = renderSidebar(
      pageState.activeCourse,
      pageState.focusStudentId,
      'toggleFocusStudent',
    );
    render();
  }

  /* The copy of an assessment in another class: switch there and open it. */
  function openCopyIn(cid, aid) {
    if (!cid || !aid) return;
    var done = cid === pageState.activeCourse ? Promise.resolve() : switchCourse(cid);
    Promise.resolve(done).then(function () {
      pageState.openAssessIds.add(aid);
      render();
      var card = document.getElementById('ac-' + aid);
      if (card && typeof card.scrollIntoView === 'function')
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /* ── DIBELS 8 benchmark ─────────────────────────────────────
     Raw scores per window: Oral Reading Fluency words correct and errors,
     Maze correct and incorrect. Accuracy, the adjusted Maze score and the
     Grade 8 levels are worked out (shared/constants.js); none of it counts
     toward a grade. One student gets two cards; the class gets one row each
     with the level counts above. Fields save when they lose focus. */
  var _dibelsPeriods = {};
  var _dibelsLoaded = {};
  function _dibelsPeriodOf(a) {
    return _dibelsPeriods[a.id] || dibelsPeriodFor(courseToday(pageState.activeCourse));
  }
  // html-safe: tone and label come from DIBELS_LEVELS for a computed level; text through esc
  function _dibelsChip(level, text) {
    if (!level) return '<span class="dbl-chip is-empty">—</span>';
    return (
      '<span class="dbl-chip ' +
      DIBELS_LEVELS[level].tone +
      '"><span class="dbl-dot" aria-hidden="true"></span>' +
      esc(text || DIBELS_LEVELS[level].label) +
      '</span>'
    );
  }
  // One student's numbers and what they work out to in one window.
  function _dibelsFigures(cid, sid, aid, period) {
    var row = getDibelsScore(cid, sid, aid, period) || {};
    var adjusted = dibelsMazeAdjusted(row.mazeCorrect, row.mazeIncorrect);
    return {
      row: row,
      accuracy: dibelsAccuracy(row.orfWrc, row.orfErrors),
      adjusted: adjusted,
      orfLevel: dibelsLevel('orf', period, row.orfWrc),
      mazeLevel: dibelsLevel('maze', period, adjusted),
    };
  }
  function _fmtDibels(n) {
    return n == null ? '' : String(Math.round(n * 10) / 10);
  }
  function _dibelsPeriodSegHtml(a) {
    var on = _dibelsPeriodOf(a);
    return (
      '<div class="grader-status dbl-period" role="group" aria-label="Benchmark window">' +
      DIBELS_PERIODS.map(function (p) {
        return (
          '<button type="button" class="grader-status-btn' +
          (p === on ? ' is-on is-period' : '') +
          '" aria-pressed="' +
          (p === on) +
          '" data-action="setDibelsPeriod" data-aid="' +
          a.id +
          '" data-period="' +
          p +
          '">' +
          DIBELS_PERIOD_NAMES[p] +
          '</button>'
        );
      }).join('<span class="grader-status-sep" aria-hidden="true"></span>') +
      '</div>'
    );
  }
  function _dibelsCutsText(period) {
    var o = DIBELS_CUTS.orf[period];
    var m = DIBELS_CUTS.maze[period];
    return (
      'Grade 8 ' +
      DIBELS_PERIOD_NAMES[period].toLowerCase() +
      ' cut points. ORF words correct: Above ' +
      o.above +
      ', Core ' +
      o.core +
      ', Strategic ' +
      o.strategic +
      '. Maze adjusted (correct − incorrect ÷ 2): Above ' +
      m.above +
      ', Core ' +
      m.core +
      ', Strategic ' +
      m.strategic +
      '.'
    );
  }
  // html-safe: fixed labels and _dibelsChip for computed levels
  function _dibelsLevelPillsHtml(cid, a, sid) {
    var f = _dibelsFigures(cid, sid, a.id, _dibelsPeriodOf(a));
    return (
      '<span class="dbl-foot-label">ORF</span>' +
      _dibelsChip(f.orfLevel) +
      '<span class="dbl-foot-label">Maze</span>' +
      _dibelsChip(f.mazeLevel)
    );
  }
  function _dibelsInput(sid, aid, field, value, label, big) {
    return (
      '<input type="text" inputmode="numeric" class="dbl-input' +
      (big ? ' is-big' : '') +
      '" value="' +
      (value == null ? '' : esc(value)) +
      '" aria-label="' +
      esc(label) +
      '" data-action-blur="dibelsField" data-sid="' +
      sid +
      '" data-aid="' +
      aid +
      '" data-field="' +
      field +
      '">'
    );
  }
  function _dibelsCardHtml(cid, a, st) {
    var period = _dibelsPeriodOf(a);
    var f = _dibelsFigures(cid, st.id, a.id, period);
    var o = DIBELS_CUTS.orf[period];
    var m = DIBELS_CUTS.maze[period];
    function stat(label, value, out) {
      return (
        '<div class="dbl-stat"><span class="dbl-stat-label">' +
        label +
        '</span><span class="dbl-stat-value" data-out="' +
        out +
        '">' +
        value +
        '</span></div>'
      );
    }
    function field(label, inner) {
      return '<label class="dbl-field"><span class="dbl-stat-label">' + label + '</span>' + inner + '</label>';
    }
    return (
      '<div class="dbl-card-wrap" data-dibels-card="' +
      a.id +
      '">' +
      '<div class="dbl-bar">' +
      _dibelsPeriodSegHtml(a) +
      '<span class="grader-spacer"></span><span class="dbl-no-grade">Doesn’t count toward grades</span></div>' +
      '<section class="grdl-card dbl-card"><div class="grdl-side"><h3 class="grdl-name">Oral Reading Fluency</h3>' +
      '<span class="grdl-text">Words read correctly and errors in the one-minute passage. Grade 8 cut points: Above ' +
      o.above +
      ', Core ' +
      o.core +
      ', Strategic ' +
      o.strategic +
      '.</span></div><div class="dbl-fields">' +
      field('Words Correct', _dibelsInput(st.id, a.id, 'orfWrc', f.row.orfWrc, 'Words correct', true)) +
      field('Errors', _dibelsInput(st.id, a.id, 'orfErrors', f.row.orfErrors, 'Errors', true)) +
      stat('Accuracy', f.accuracy == null ? '—' : f.accuracy + '%', 'accuracy') +
      stat('Level', _dibelsChip(f.orfLevel), 'orfLevel') +
      '</div></section>' +
      '<section class="grdl-card dbl-card"><div class="grdl-side"><h3 class="grdl-name">Maze</h3>' +
      '<span class="grdl-text">Correct and incorrect answers. Adjusted = correct − incorrect ÷ 2. Cut points: Above ' +
      m.above +
      ', Core ' +
      m.core +
      ', Strategic ' +
      m.strategic +
      '.</span></div><div class="dbl-fields">' +
      field('Correct', _dibelsInput(st.id, a.id, 'mazeCorrect', f.row.mazeCorrect, 'Maze correct', true)) +
      field('Incorrect', _dibelsInput(st.id, a.id, 'mazeIncorrect', f.row.mazeIncorrect, 'Maze incorrect', true)) +
      stat('Adjusted', f.adjusted == null ? '—' : _fmtDibels(f.adjusted), 'adjusted') +
      stat('Level', _dibelsChip(f.mazeLevel), 'mazeLevel') +
      '</div></section></div>'
    );
  }
  // html-safe: counts are numbers; row names, cut points and window names are constants; ids are ours
  function _dibelsCountsHtml(cid, a, students, period) {
    var counts = { orf: {}, maze: {} };
    var tested = 0;
    students.forEach(function (st) {
      var status = getAssignmentStatus(cid, st.id, a.id);
      if (status === 'NS' || status === 'EXC') return;
      var f = _dibelsFigures(cid, st.id, a.id, period);
      if (f.orfLevel || f.mazeLevel) tested++;
      if (f.orfLevel) counts.orf[f.orfLevel] = (counts.orf[f.orfLevel] || 0) + 1;
      if (f.mazeLevel) counts.maze[f.mazeLevel] = (counts.maze[f.mazeLevel] || 0) + 1;
    });
    function line(name, key) {
      return (
        '<div class="dbl-count-row"><span class="dbl-count-name">' +
        name +
        '</span>' +
        ['above', 'core', 'strategic', 'intensive']
          .map(function (lv) {
            return '<span class="dbl-count">' + _dibelsChip(lv) + '<b>' + (counts[key][lv] || 0) + '</b></span>';
          })
          .join('') +
        '</div>'
      );
    }
    return (
      '<div class="dbl-summary">' +
      '<div class="dbl-bar">' +
      _dibelsPeriodSegHtml(a) +
      '<span class="dbl-tested"><b>' +
      tested +
      '</b> of ' +
      students.length +
      ' tested</span><span class="grader-spacer"></span><span class="dbl-no-grade">Doesn’t count toward grades</span></div>' +
      line('ORF', 'orf') +
      line('Maze', 'maze') +
      '<span class="dbl-cuts">' +
      _dibelsCutsText(period) +
      '</span></div>'
    );
  }
  function _dibelsRowHtml(cid, a, st, period) {
    var f = _dibelsFigures(cid, st.id, a.id, period);
    var status = getAssignmentStatus(cid, st.id, a.id);
    var name = displayNameWithLast(st);
    return (
      '<div class="score-row dbl-row' +
      (status === 'NS' || status === 'EXC' ? ' has-status' : '') +
      '" data-status-student="' +
      st.id +
      '" data-status-assess="' +
      a.id +
      '">' +
      '<span class="ldg-name">' +
      esc(name) +
      '</span>' +
      _dibelsInput(st.id, a.id, 'orfWrc', f.row.orfWrc, 'Words correct, ' + name) +
      _dibelsInput(st.id, a.id, 'orfErrors', f.row.orfErrors, 'Errors, ' + name) +
      '<span class="dbl-num" data-out="accuracy">' +
      (f.accuracy == null ? '' : f.accuracy + '%') +
      '</span>' +
      '<span data-out="orfLevel">' +
      (f.orfLevel ? _dibelsChip(f.orfLevel) : '') +
      '</span>' +
      '<span class="dbl-divider" aria-hidden="true"></span>' +
      _dibelsInput(st.id, a.id, 'mazeCorrect', f.row.mazeCorrect, 'Maze correct, ' + name) +
      _dibelsInput(st.id, a.id, 'mazeIncorrect', f.row.mazeIncorrect, 'Maze incorrect, ' + name) +
      '<span class="dbl-num" data-out="adjusted">' +
      _fmtDibels(f.adjusted) +
      '</span>' +
      '<span data-out="mazeLevel">' +
      (f.mazeLevel ? _dibelsChip(f.mazeLevel) : '') +
      '</span>' +
      '<div class="ldg-status grader-status" role="group" aria-label="Status">' +
      _graderStatusButtons(a.id, st.id, status, ['EXC', 'NS'])
        .replace(/class="grader-status-btn/g, 'class="grader-status-btn ldg-chip')
        .replace(/data-status=/g, 'data-stop-prop="true" tabindex="-1" data-status=') +
      '</div>' +
      '</div>'
    );
  }
  function _dibelsGridHtml(cid, a, students) {
    var period = _dibelsPeriodOf(a);
    return (
      '<div class="dbl-grid" data-aid="' +
      a.id +
      '">' +
      _dibelsCountsHtml(cid, a, students, period) +
      '<div class="dbl-head dbl-head-groups"><span></span><span class="dbl-group">Oral Reading Fluency</span><span></span><span class="dbl-group">Maze</span><span></span></div>' +
      '<div class="dbl-head"><span>Student</span><span class="is-num">Words Correct</span><span class="is-num">Errors</span><span class="is-num">Accuracy</span><span>ORF Level</span><span></span><span class="is-num">Correct</span><span class="is-num">Incorrect</span><span class="is-num">Adjusted</span><span>Maze Level</span><span class="is-end">Status</span></div>' +
      students
        .map(function (st) {
          return _dibelsRowHtml(cid, a, st, period);
        })
        .join('') +
      '</div>'
    );
  }
  // A field left: save the window's four numbers, then redraw what they
  // work out to without redrawing the inputs, so Tab keeps moving on.
  function _commitDibelsField(el) {
    var cid = pageState.activeCourse;
    var sid = el.dataset.sid;
    var aid = el.dataset.aid;
    var a = getAssessments(cid).find(function (x) {
      return x.id === aid;
    });
    if (!a) return;
    var period = _dibelsPeriodOf(a);
    var values = Object.assign({}, getDibelsScore(cid, sid, aid, period) || {});
    var raw = el.value.trim();
    var n = raw === '' ? null : Math.floor(Number(raw));
    values[el.dataset.field] = raw === '' || !isFinite(n) || n < 0 ? null : n;
    el.value = values[el.dataset.field] == null ? '' : values[el.dataset.field];
    Grader.setDibels(cid, sid, aid, period, values);
    var f = _dibelsFigures(cid, sid, aid, period);
    var scope = el.closest('.dbl-row') || el.closest('.dbl-card-wrap');
    if (!scope) return;
    // A grid row leaves an empty figure blank; the card shows a dash.
    var none = scope.classList.contains('dbl-row') ? '' : '—';
    scope.querySelector('[data-out="accuracy"]').textContent = f.accuracy == null ? none : f.accuracy + '%';
    scope.querySelector('[data-out="adjusted"]').textContent = f.adjusted == null ? none : _fmtDibels(f.adjusted);
    scope.querySelector('[data-out="orfLevel"]').innerHTML = f.orfLevel || none ? _dibelsChip(f.orfLevel) : '';
    scope.querySelector('[data-out="mazeLevel"]').innerHTML = f.mazeLevel || none ? _dibelsChip(f.mazeLevel) : '';
    if (scope.classList.contains('dbl-row')) {
      var grid = scope.closest('.dbl-grid');
      var summary = grid && grid.querySelector('.dbl-summary');
      if (summary) {
        // Only the counts: the window buttons stay, so a click that ended
        // this field's edit still lands on them.
        var fresh = document.createElement('div');
        fresh.innerHTML = _dibelsCountsHtml(cid, a, sortStudents(getStudents(cid), 'lastName'), period);
        summary.querySelector('.dbl-tested').replaceWith(fresh.querySelector('.dbl-tested'));
        var rows = summary.querySelectorAll('.dbl-count-row');
        fresh.querySelectorAll('.dbl-count-row').forEach(function (row, i) {
          rows[i].replaceWith(row);
        });
      }
    } else {
      // One student: the footer's levels, in the dialog or the inline head.
      var holder = scope.closest('#grader-overlay, .assess-card');
      var levels = holder && holder.querySelector('.grader-dibels-levels');
      if (levels) levels.innerHTML = _dibelsLevelPillsHtml(cid, a, sid);
    }
    refreshSidebarGrades(sid);
  }
  function setDibelsPeriod(aid, period) {
    if (DIBELS_PERIODS.indexOf(period) < 0) return;
    _dibelsPeriods[aid] = period;
    render();
  }
  // The class's DIBELS scores come from the server once per class.
  function _loadDibelsOnce(cid) {
    if (_dibelsLoaded[cid] || typeof loadDibelsScores !== 'function') return;
    var any = getAssessments(cid).some(isDibelsScored);
    if (!any) return;
    _dibelsLoaded[cid] = true;
    loadDibelsScores(cid).then(function (changed) {
      if (changed && pageState.activeCourse === cid) render();
    });
  }
  /* A plain black-and-white sheet of the class's scores in the shown
     window, printed from a hidden frame. */
  function printDibels(aid) {
    var cid = pageState.activeCourse;
    var a = getAssessments(cid).find(function (x) {
      return x.id === aid;
    });
    if (!a) return;
    var period = _dibelsPeriodOf(a);
    var students = sortStudents(getStudents(cid), 'lastName');
    var rows = students
      .map(function (st) {
        var f = _dibelsFigures(cid, st.id, aid, period);
        var status = getAssignmentStatus(cid, st.id, aid);
        var r = f.row;
        function v(x) {
          return x == null ? '' : esc(String(x));
        }
        return (
          '<tr><th>' +
          esc(displayNameWithLast(st)) +
          '</th><td>' +
          v(r.orfWrc) +
          '</td><td>' +
          v(r.orfErrors) +
          '</td><td>' +
          (f.accuracy == null ? '' : f.accuracy + '%') +
          '</td><td>' +
          (f.orfLevel ? DIBELS_LEVELS[f.orfLevel].label : '') +
          '</td><td>' +
          v(r.mazeCorrect) +
          '</td><td>' +
          v(r.mazeIncorrect) +
          '</td><td>' +
          _fmtDibels(f.adjusted) +
          '</td><td>' +
          (f.mazeLevel ? DIBELS_LEVELS[f.mazeLevel].label : '') +
          '</td><td>' +
          (status === 'NS' ? 'Missing' : status === 'EXC' ? 'Excused' : '') +
          '</td></tr>'
        );
      })
      .join('');
    var course = COURSES[cid] || {};
    // The saved PDF's name: "DIBELS 8 Benchmark – Science 8 Block B – Beginning of Year".
    var fileName = printFileName([
      a.title || 'DIBELS 8 Benchmark',
      printClassName(course),
      DIBELS_PERIOD_NAMES[period],
    ]);
    var html =
      '<!doctype html><html><head><meta charset="utf-8"><title>' +
      esc(fileName) +
      '</title><style>' +
      'body{font-family:-apple-system,system-ui,sans-serif;color:#000;margin:0.4in;font-size:10pt}' +
      'h1{font-size:15pt;margin:0 0 2pt}p{margin:0 0 8pt}' +
      'table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:3pt 5pt;text-align:right}' +
      'th{text-align:left;font-weight:700}thead th{text-align:center;background:#eee}' +
      '.cuts{font-size:8.5pt;margin-top:8pt}' +
      '</style></head><body><h1>' +
      esc(a.title || 'DIBELS 8 Benchmark') +
      '</h1><p>' +
      esc([course.name, DIBELS_PERIOD_NAMES[period], a.date ? formatDate(a.date) : ''].filter(Boolean).join(' · ')) +
      '</p><table><thead><tr><th rowspan="2">Student</th><th colspan="4">Oral Reading Fluency</th><th colspan="4">Maze</th><th rowspan="2">Status</th></tr>' +
      '<tr><th>Words Correct</th><th>Errors</th><th>Accuracy</th><th>Level</th><th>Correct</th><th>Incorrect</th><th>Adjusted</th><th>Level</th></tr></thead><tbody>' +
      rows +
      '</tbody></table><p class="cuts">' +
      esc(_dibelsCutsText(period)) +
      ' DIBELS scores count toward no grade.</p></body></html>';
    var frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);
    frame.contentDocument.open();
    frame.contentDocument.write(html);
    frame.contentDocument.close();
    setTimeout(function () {
      // The frame's title names the file; the page's too, for a browser that names it from the page.
      var restoreTitle = setPrintTitle([fileName]);
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(function () {
        restoreTitle();
        frame.remove();
      }, 1000);
    }, 50);
  }

  /* ── Levels, points and Complete/Incomplete for one student ── */
  // On rubric work a competency is scored through the criteria that feed
  // it: it shows their level (one level, or the lowest marked mixed, with
  // no ±), and a level set on it goes to each of them. Any other key is
  // scored on its own.
  function _tagCriteria(cid, aid, tagId) {
    var a = getAssessments(cid).find(function (x) {
      return x.id === aid;
    });
    return a ? rubricCriteriaForTag(cid, a, tagId) : [];
  }
  // A whole-rubric competency has no keys of its own: its criteria are
  // scored one by one.
  function _tagScoreKeys(cid, aid, tagId) {
    var a = getAssessments(cid).find(function (x) {
      return x.id === aid;
    });
    return a ? rubricRowScoreKeys(cid, a, tagId) : [tagId];
  }
  function _setTagScore(cid, sid, aid, tagId, value, mod) {
    _tagScoreKeys(cid, aid, tagId).forEach(function (key) {
      Grader.setLevel(cid, sid, aid, key, value, mod);
    });
  }
  function _tagState(cid, sid, aid, tagId) {
    var crits = _tagCriteria(cid, aid, tagId);
    if (crits.length) {
      var a = getAssessments(cid).find(function (x) {
        return x.id === aid;
      });
      var lv = competencyLevelFromCriteria(cid, sid, a, tagId, crits);
      if (!lv) return { level: 0, mod: 0, mixed: false };
      return { level: lv.score, mod: lv.mixed ? 0 : lv.mod, mixed: lv.mixed };
    }
    var e = (getScores(cid)[sid] || []).find(function (x) {
      return x.assessmentId === aid && x.tagId === tagId;
    });
    var v = e ? Number(e.score) || 0 : 0;
    return { level: v, mod: v && e.mod ? e.mod : 0, mixed: false };
  }
  function _graderStepperHtml(level, mod, attrs) {
    var name = PROF_LABELS[level] || '';
    var off = !level;
    return (
      '<span class="grdl-stepper" role="group" aria-label="Fine-tune' +
      (name ? ' ' + name : '') +
      '">' +
      '<button type="button" ' +
      attrs +
      ' data-mod="-1" aria-label="Low ' +
      name +
      '" aria-pressed="' +
      (mod < 0) +
      '"' +
      (off || normalizeScoreMod(level, -1) !== -1 ? ' disabled' : '') +
      (mod < 0 ? ' class="is-on"' : '') +
      '>−</button><span class="grdl-stepper-sep" aria-hidden="true"></span>' +
      '<button type="button" ' +
      attrs +
      ' data-mod="1" aria-label="High ' +
      name +
      '" aria-pressed="' +
      (mod > 0) +
      '"' +
      (off || normalizeScoreMod(level, 1) !== 1 ? ' disabled' : '') +
      (mod > 0 ? ' class="is-on"' : '') +
      '>+</button></span>'
    );
  }
  // The chosen level holds its − | +, as a chosen rubric tile does, so the
  // fine-tune sits on the level it changes and picking moves nothing else.
  function _graderPickHtml(levelBtn, colour, level, mod, attrs, mixed) {
    return (
      '<span class="grdl-pick l' +
      colour +
      (mixed ? ' mixed' : '') +
      '">' +
      levelBtn +
      _graderStepperHtml(level, mod, attrs) +
      '</span>'
    );
  }
  function _levelCardsHtml(cid, a, tagObjs, st) {
    var order = levelOrderFor(cid);
    // Feedback per competency lives on tag_score, which rubric work doesn't use.
    var withNotes = !a.rubricId;
    return (
      '<div class="grdl-cards">' +
      tagObjs
        .map(function (t) {
          var state = _tagState(cid, st.id, a.id, t.id);
          var tag = t.tag || null;
          var code = tag ? tag.code || (tag.id && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(tag.id) ? tag.id : '') : '';
          var seg = order
            .map(function (lv) {
              var on = state.level === lv;
              var btn =
                '<button type="button" class="grdl-level' +
                (on ? ' is-on l' + lv + (state.mixed ? ' mixed' : '') : '') +
                '" data-action="graderTagLevel" data-tag="' +
                esc(t.id) +
                '" data-level="' +
                lv +
                '" aria-pressed="' +
                on +
                '">' +
                PROF_LABELS[lv] +
                '</button>';
              return on
                ? _graderPickHtml(
                    btn,
                    lv,
                    state.mixed ? 0 : state.level,
                    state.mod,
                    'data-action="graderTagMod" data-tag="' + esc(t.id) + '"',
                    state.mixed,
                  )
                : btn;
            })
            .join('');
          return (
            '<section class="grdl-card" tabindex="0" data-tag="' +
            esc(t.id) +
            '" aria-label="' +
            esc(t.label || '') +
            '">' +
            '<div class="grdl-side"><div class="grdl-name-row"><h3 class="grdl-name">' +
            esc(t.label || '') +
            '</h3>' +
            (code ? '<span class="grdt-code">' + esc(code) + '</span>' : '') +
            '</div>' +
            (t.text && t.text !== t.label ? '<span class="grdl-text">' + esc(t.text) + '</span>' : '') +
            (state.level ? '' : '<span class="grdt-not-scored">' + _NOT_SCORED_ICON + 'Not Scored</span>') +
            '</div>' +
            '<div class="grdl-controls"><div class="grdl-seg" role="group" aria-label="Level">' +
            seg +
            '</div>' +
            '</div>' +
            (withNotes ? _tagNoteHtml(cid, a.id, st.id, t.id) : '') +
            '</section>'
          );
        })
        .join('') +
      '</div>'
    );
  }
  // The competency's Comment (Optional) box, one line until it has focus
  // or text, as under a rubric criterion.
  function _tagNoteHtml(cid, aid, sid, tagId) {
    var note = getTagComment(cid, sid, aid, tagId);
    var id = 'grdl-note-' + esc(aid) + '-' + esc(tagId);
    return (
      '<label class="grdt-note-label grdl-note-label" for="' +
      id +
      '">Comment (Optional)</label>' +
      '<textarea id="' +
      id +
      '" class="grdt-note' +
      (note ? ' has-text' : '') +
      '" rows="1" data-action-blur="graderTagNote" data-tag="' +
      esc(tagId) +
      '">' +
      esc(note) +
      '</textarea>'
    );
  }
  function _pointsCardHtml(cid, a, st) {
    var max = Number(a.maxPoints) || 100;
    var raw = getPointsScore(cid, st.id, a.id);
    var status = getAssignmentStatus(cid, st.id, a.id);
    var locked = status === 'NS' || status === 'EXC';
    return (
      '<section class="grdp-card">' +
      '<div class="grdl-side"><label class="grdl-name" for="grdp-input-' +
      esc(a.id) +
      '">Score</label>' +
      '<span class="grdl-text">Type the points earned. Up to twice the total counts as extra credit.</span></div>' +
      '<div class="grdp-entry"><input id="grdp-input-' +
      esc(a.id) +
      '" class="grdp-input" type="text" inputmode="decimal" autocomplete="off"' +
      ' data-action-blur="graderPoints" data-max="' +
      max +
      '" value="' +
      (raw != null ? esc(formatPoints(raw)) : '') +
      '"' +
      (locked ? ' disabled' : '') +
      '><span class="grdp-max">/ ' +
      esc(formatPoints(max)) +
      '</span>' +
      (raw != null ? '<span class="grdp-pct">' + formatPointsPercent(raw, max) + '</span>' : '') +
      '</div></section>'
    );
  }
  function _completeCardHtml(cid, a, st) {
    var mark = getCompletionMark(cid, st.id, a.id);
    var status = getAssignmentStatus(cid, st.id, a.id);
    var locked = status === 'NS' || status === 'EXC';
    function btn(value, label, icon) {
      var on = mark === value;
      return (
        '<button type="button" class="grdc-btn grdc-' +
        value +
        (on ? ' is-on' : '') +
        '" data-action="graderMark" data-mark="' +
        value +
        '" aria-pressed="' +
        on +
        '"' +
        (locked ? ' disabled' : '') +
        '>' +
        icon +
        label +
        '</button>'
      );
    }
    return (
      '<section class="grdp-card">' +
      '<div class="grdl-side"><h3 class="grdl-name">Mark</h3><span class="grdl-text">Click again to clear the mark.</span></div>' +
      '<div class="grdc-pair" role="group" aria-label="Mark">' +
      btn(
        'complete',
        'Complete',
        '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" class="grdc-icon-bg"/><path d="M7.5 12.5l3 3 6-6.5" fill="none" class="grdc-icon-mark" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      ) +
      btn(
        'incomplete',
        'Incomplete',
        '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" class="grdc-icon-bg"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" fill="none" class="grdc-icon-mark" stroke-width="2.4" stroke-linecap="round"/></svg>',
      ) +
      '</div></section>'
    );
  }

  // Whether a card is drawn open: one student's view opens every card but
  // the ones closed (Expand), or the ones opened.
  function _cardOpen(aid) {
    return pageState.focusStudentId && pageState._allExpanded
      ? !pageState._collapsedIds.has(aid)
      : pageState.openAssessIds.has(aid);
  }

  // An open card's body: its description and its grading controls.
  // html-safe: the description goes through esc; the grading builders are reviewed
  function _cardBodyHtml(cid, a, focusSt, students, scores) {
    students = AssignShow.students(cid, a, students);
    var tagObjs = _scoreTagObjs(cid, a);
    return (
      (a.description
        ? '<div style="font-size:0.9375rem;color:var(--text-2);margin:8px 0 12px;line-height:1.5;padding:10px 14px;background:var(--bg);border-radius:var(--radius-sm)">' +
          esc(a.description) +
          '</div>'
        : '') +
      (focusSt
        ? _inlineGraderHtml(cid, a, tagObjs, focusSt, scores)
        : _graderHtml(cid, a, tagObjs, pageState.focusStudentId ? [] : _groupRowStudents(cid, a, students), scores))
    );
  }

  /* The counts in a card's header that grading in place leaves as they
     were drawn: Missing, To Grade and Grade Submissions. Opening or closing
     a card brings them up to date (_refreshCardCounts), as the whole
     redraw it replaced did. */
  // html-safe: numbers, fixed words and icons; the builders are reviewed
  function _cardCounts(cid, a, students, shownIds, tograde) {
    // Students whose work is labelled Missing, whatever the due date.
    var missingCount = students.filter(function (st) {
      return getAssignmentStatus(cid, st.id, a.id) === 'NS';
    }).length;
    var meta =
      (missingCount
        ? '<span class="assess-missing" title="' +
          missingCount +
          (missingCount === 1 ? ' student' : ' students') +
          ' labelled Missing">' +
          _WARNING_ICON +
          missingCount +
          ' missing</span>'
        : '') + AssignShow.toGradeChipHtml(cid, a, shownIds, tograde);
    var out = { meta: meta, button: _gradeSubmissionsHtml(cid, a, shownIds, tograde) };
    _drawnReturn('n' + a.id, meta + '|' + out.button);
    return out;
  }
  // One word of a card's data-has, in the order a redraw writes them.
  function _setHas(card, word, on) {
    var has = (card.dataset.has || '').split(' ');
    var words = ['submitted', 'tograde', 'toreturn', 'notin']
      .filter(function (w) {
        return w === word ? on : has.indexOf(w) >= 0;
      })
      .join(' ');
    if (words) card.dataset.has = words;
    else card.removeAttribute('data-has');
  }
  function _refreshCardCounts(cid, byId, students, shownIds) {
    var classOn = GraderWork.workOnInClass(cid);
    var total = 0;
    document.querySelectorAll('#main .assess-card').forEach(function (card) {
      var a = byId[card.id.slice(3)];
      var head = card.querySelector('.assess-header');
      if (!a || !head) return;
      var wc = classOn ? GraderWork.workCounts(cid, a.id, shownIds) : null;
      var tograde = wc ? wc.tograde : undefined;
      total += tograde || 0;
      if (wc) {
        _setHas(card, 'tograde', wc.tograde > 0);
        _setHas(card, 'notin', wc.notin > 0);
      }
      var c = _cardCounts(cid, a, students, shownIds, tograde);
      if (head._countsHtml === c.meta + '|' + c.button) return;
      head._countsHtml = c.meta + '|' + c.button;
      head.querySelectorAll('.assess-missing, .assess-to-grade, .assess-grade-work-btn').forEach(function (el) {
        el.remove();
      });
      // html-safe: built by _cardCounts
      head.querySelector('.assess-date').insertAdjacentHTML('afterend', c.meta);
      // html-safe: built by _gradeSubmissionsHtml
      head.querySelector('.assess-header-actions').insertAdjacentHTML('afterbegin', c.button);
    });
    if (classOn) AssignShow.toGradeTotal(total);
  }

  // The new or edit form's place, above the cards or the List.
  // html-safe: the form escapes its own text
  function _newFormHtml(cid) {
    return (
      '<div id="new-assess-form" data-cid="' +
      esc(cid) +
      '" style="display:' +
      (pageState._showingNewForm ? 'block' : 'none') +
      ';background:var(--bg);border:2px solid var(--active);border-radius:var(--radius);padding:16px;margin-bottom:16px;box-shadow:0 4px 20px rgba(0,122,255,0.12)">' +
      // An open form kept through this redraw is put back by render().
      (pageState._showingNewForm && !pageState._keepingForm
        ? renderAssessForm(
            cid,
            pageState._editingAssessId
              ? getAssessments(cid).find(function (a) {
                  return a.id === pageState._editingAssessId;
                })
              : null,
          )
        : '') +
      '</div>'
    );
  }

  // html-safe: titles, descriptions, category/rubric/module names through esc; colours through cssColor or fixed palettes; grading builders reviewed
  function renderAssessmentList(cid, assessments, allAssessments, students, scores, modules, nums, shownIds) {
    var html =
      '<div class="settings-grid" style="display:grid;grid-template-columns:1fr;gap:20px;align-items:start;padding:12px 12px 20px">';
    html += '<div>';

    html += _newFormHtml(cid);

    // Assessment cards grouped by module folders
    var focusSt = pageState.focusStudentId
      ? students.find(function (st) {
          return st.id === pageState.focusStudentId;
        })
      : null;
    // What is waiting to return (S1-F2), in a class that holds grades.
    var holds = _holdsGrades(cid);
    function renderAssessCard(a, isUncategorized) {
      var isOpen = _cardOpen(a.id);
      var n = nums[a.id] || {};
      var counts = _cardCounts(cid, a, students, shownIds, n.tograde);
      var categoryId = _getAssessmentCategoryId(a);
      var categoryName = _getCategoryName(cid, categoryId);
      var c =
        '<div class="assess-card' +
        (isOpen ? ' open active' : '') +
        (a.isDraft ? ' is-draft' : '') +
        '" id="ac-' +
        a.id +
        '"' +
        _cardHas(n) +
        ' draggable="true"' +
        ' data-assess-drag="' +
        a.id +
        '"' +
        ' data-assess-card-drop="' +
        a.id +
        '"' +
        '>' +
        '<div class="assess-header" data-action="toggleAssess" data-aid="' +
        a.id +
        '">' +
        '<span class="assess-grip" aria-hidden="true" title="Drag to reorder">⠿</span>' +
        '<div class="assess-header-info">' +
        '<span class="assess-title">' +
        esc(a.title) +
        '</span>' +
        '<span class="assess-meta">' +
        (function () {
          if (assessmentNeedsCategory(cid, a))
            return (
              '<span class="type-badge type-badge-needs"' +
              _chipTipAttrs(NEEDS_CATEGORY_LABEL, NEEDS_CATEGORY_TIP) +
              '>' +
              esc(NEEDS_CATEGORY_LABEL) +
              '</span>'
            );
          var idx = categoryId
            ? (getCategories(cid) || []).findIndex(function (c) {
                return c.id === categoryId;
              })
            : -1;
          var t =
            typeof categoryTintByIndex === 'function' ? categoryTintByIndex(idx, categoryName) : { bg: '', fg: '' };
          // With a category, the pill is a button: it filters the list to it.
          return (
            '<' +
            (categoryId
              ? 'button type="button" data-action="toggleCategoryFilter" data-catid="' +
                esc(categoryId) +
                '" aria-pressed="' +
                (pageState.filterCategories.indexOf(categoryId) >= 0) +
                '"'
              : 'span') +
            ' class="type-badge ' +
            (categoryId ? 'type-badge-s' : 'type-badge-f') +
            '"' +
            _chipTipAttrs(categoryName, _categoryChipTip(cid, categoryId)) +
            ' style="background:' +
            t.bg +
            ';color:' +
            t.fg +
            '">' +
            esc(categoryName) +
            '</' +
            (categoryId ? 'button' : 'span') +
            '>'
          );
        })() +
        (a.rubricId
          ? (function () {
              var r = getRubricById(cid, a.rubricId);
              return r
                ? '<span class="rubric-badge"' +
                    _chipTipAttrs(r.name, 'The rubric used to grade this work.') +
                    '>' +
                    _RUBRIC_ICON +
                    esc(r.name) +
                    '</span>'
                : '';
            })()
          : '') +
        _cardScoringBadges(a) +
        // A quiz's results (teacher/quiz-results.js): '' with the quizzes switch off.
        (window.QuizResults ? QuizResults.cardLine(cid, a) : '') +
        (a.coreCompetencyIds || [])
          .map(function (ccId) {
            var cc = getCoreCompetency(ccId);
            return cc
              ? '<span class="cc-badge"' +
                  _chipTipAttrs(cc.label, 'Core Competency') +
                  ' style="border-color:' +
                  cc.color +
                  ';color:' +
                  tintText(cc.color) +
                  '">' +
                  esc(cc.id) +
                  '</span>'
              : '';
          })
          .join('') +
        (a.collaboration && a.collaboration !== 'individual'
          ? '<span class="collab-badge">' + esc(a.collaboration[0].toUpperCase() + a.collaboration.slice(1)) + '</span>'
          : '') +
        (window.AssessmentCopy ? AssessmentCopy.renderCardCopies(cid, a) : '') +
        AssignDraft.chipHtml(cid, a) +
        '<span class="assess-date">' +
        // Assigned \u2192 due. `date` is the assigned date (date_assigned on the
        // server); the due date is its own field.
        formatDate(a.dateAssigned || a.date) +
        (a.dueDate ? ' \u2192 ' + formatDate(a.dueDate) : '') +
        '</span>' +
        counts.meta +
        (holds && !isDibelsScored(a)
          ? '<span class="assess-returns" data-returns-aid="' +
            a.id +
            '">' +
            _drawnReturn('c' + a.id, _returnChipsHtml(cid, a, shownIds, _drawnReturn('d' + a.id, n.drafts))) +
            '</span>'
          : '') +
        '</span>' +
        '</div>' +
        '<div class="assess-header-actions" data-stop-prop="true">' +
        counts.button +
        (holds && !isDibelsScored(a)
          ? '<span class="assess-return-slot" data-return-slot-aid="' +
            a.id +
            '">' +
            _drawnReturn('s' + a.id, _returnDraftsButtonHtml(cid, a, shownIds)) +
            '</span>'
          : '') +
        AssignDraft.assignButtonHtml(cid, a) +
        _cardMoreMenuHtml(cid, a) +
        '</div>' +
        '<span class="assess-chevron" aria-hidden="true">' +
        _CHEVRON_ICON +
        '</span>' +
        '</div>' +
        // A closed card has no body: its grid is built when it opens. (Every
        // card's whole-class grid used to be built and kept out of sight:
        // 80,000 elements on a class of 30 with 36 pieces.)
        '<div class="assess-body">' +
        (isOpen ? (a.isDraft ? AssignDraft.bodyHtml(cid, a) : _cardBodyHtml(cid, a, focusSt, students, scores)) : '') +
        '</div>' +
        '</div>';
      return c;
    }

    // Group assessments by module
    var grouped = {};
    modules.forEach(function (u) {
      grouped[u.id] = [];
    });
    grouped['__none__'] = [];
    assessments.forEach(function (a) {
      var key = a.moduleId && grouped[a.moduleId] ? a.moduleId : '__none__';
      grouped[key].push(a);
    });

    // A search or filter opens every module with matches; the Show bar only
    // lists, and leaves folders and cards as the teacher has them.
    var opensFolders =
      pageState.filterCategories.length > 0 ||
      pageState.showUngraded ||
      !!pageState.assessSearch ||
      pageState._toReturnOnly;
    var filtersActive = opensFolders || AssignShow.on();
    if (!opensFolders) pageState._filterClosedModules = {};

    // Nothing to show: say so first, above any modules.
    if (assessments.length === 0 && allAssessments.length > 0) {
      html +=
        '<div class="assess-list-empty" style="text-align:center;color:var(--text-3);padding:40px 0">' +
        '<div style="font-size:0.9375rem;margin-bottom:4px">No matching assessments.</div>' +
        '<div style="font-size:0.8125rem">Try adjusting your filters or <button type="button" data-action="clearAssessFilters" style="font:inherit;color:var(--link);text-decoration:underline;background:none;border:0;padding:0;cursor:pointer">clear all filters</button>.</div>' +
        '</div>';
    } else if (allAssessments.length === 0) {
      html +=
        '<div class="empty-state assess-list-empty">' +
        '<div class="empty-state-title">No assessments yet</div>' +
        '<div class="empty-state-text">Create your first assessment to start grading.</div>' +
        '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:16px">' +
        _newQuizBtn(cid) +
        '<button class="tb-action-btn" data-action="showNewForm">+ New Assessment</button>' +
        '</div>' +
        '</div>';
    }

    // Render module folders with drop zones
    modules.forEach(function (u, idx) {
      var items = grouped[u.id];
      if (filtersActive && items.length === 0) return;
      var isOpen = !pageState.collapsedModules[u.id];
      var containsOpen =
        pageState.openAssessIds.size > 0 &&
        items.some(function (a) {
          return pageState.openAssessIds.has(a.id);
        });
      // Searching or filtering shows every module with matches open.
      var folderOpen = opensFolders ? !pageState._filterClosedModules[u.id] : isOpen || containsOpen;
      html += '<div class="mod-drop-zone" data-drop-index="' + idx + '" data-mod-drop-zone="true"></div>';
      html +=
        '<div class="mod-folder' +
        (folderOpen ? ' open' : '') +
        '" style="--mod-color:' +
        cssColor(u.color || '#6366f1') +
        '" data-module-id="' +
        u.id +
        '" draggable="true" data-module-drag="' +
        u.id +
        '" data-folder-drop="' +
        u.id +
        '">' +
        '<div class="mod-folder-header" data-action="toggleModuleFolder" data-uid="' +
        u.id +
        '">' +
        '<span class="mod-folder-grip" aria-hidden="true" title="Drag to reorder">\u2807</span>' +
        '<span class="mod-folder-chevron" aria-hidden="true">' +
        _MODULE_CHEVRON +
        '</span>' +
        '<button type="button" class="mod-folder-color" style="background:' +
        cssColor(u.color || '#6366f1') +
        '" title="Change colour" aria-label="Change colour" aria-haspopup="dialog" draggable="false"' +
        ' data-action="openModuleColorPop" data-moduleid="' +
        u.id +
        '" data-stop-prop="true"></button>' +
        '<input class="mod-folder-name-input" value="' +
        esc(u.name) +
        '" size="' +
        Math.max(4, (u.name || '').length) +
        '" title="' +
        esc(u.name) +
        '" aria-label="Module name" spellcheck="false" autocomplete="off" draggable="false"' +
        ' data-stop-prop="true" data-action-blur="moduleName" data-moduleid="' +
        u.id +
        '">' +
        '<span class="mod-folder-meta">' +
        items.length +
        ' Assignment' +
        (items.length !== 1 ? 's' : '') +
        '</span>' +
        '<div class="mod-folder-actions" data-stop-prop="true">' +
        '<button class="mod-folder-action delete" data-action="deleteModule" data-uid="' +
        u.id +
        '" data-count="' +
        items.length +
        '" title="Delete module" aria-label="Delete module">' +
        _MODULE_TRASH +
        '</button>' +
        '</div>' +
        '</div>' +
        '<div class="mod-folder-body">' +
        (items.length > 0
          ? items
              .map(function (a) {
                return renderAssessCard(a);
              })
              .join('')
          : '<div class="mod-folder-empty">Drop assignments here or create a new one</div>') +
        '</div>' +
        '</div>';
    });
    if (modules.length > 0) {
      html += '<div class="mod-drop-zone" data-drop-index="' + modules.length + '" data-mod-drop-zone="true"></div>';
    }

    // Ungrouped assessments
    var ungrouped = grouped['__none__'];
    if (modules.length === 0) {
      ungrouped.forEach(function (a) {
        html += renderAssessCard(a, true);
      });
    } else if (filtersActive && ungrouped.length === 0) {
      // hide
    } else {
      var noModOpen = !pageState.collapsedModules['__none__'];
      var containsOpenNoMod =
        pageState.openAssessIds.size > 0 &&
        ungrouped.some(function (a) {
          return pageState.openAssessIds.has(a.id);
        });
      var folderOpen = opensFolders
        ? !pageState._filterClosedModules['__none__']
        : (ungrouped.length > 0 && noModOpen) || containsOpenNoMod;
      html +=
        '<div class="mod-folder no-module' +
        (folderOpen ? ' open' : '') +
        (ungrouped.length === 0 ? ' empty-target' : '') +
        '" data-module-id="__none__" data-folder-drop="__none__">' +
        '<div class="mod-folder-header" data-action="toggleModuleFolder" data-uid="__none__">' +
        '<span class="mod-folder-chevron" aria-hidden="true">' +
        _MODULE_CHEVRON +
        '</span>' +
        '<span class="mod-folder-name">Ungrouped Assignments</span>' +
        '<span class="mod-folder-meta">' +
        ungrouped.length +
        ' Assignment' +
        (ungrouped.length !== 1 ? 's' : '') +
        '</span>' +
        '</div>' +
        '<div class="mod-folder-body">' +
        (ungrouped.length > 0
          ? ungrouped
              .map(function (a) {
                return renderAssessCard(a, true);
              })
              .join('')
          : '<div class="mod-folder-empty">Drop an assignment here to take it out of its module</div>') +
        '</div>' +
        '</div>';
    }

    if (!filtersActive) html += '<button class="add-module-btn" data-action="addModuleInline">+ Add Module</button>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  /* ── Main render ────────────────────────────────────────── */
  /* ── Card chip tips ─────────────────────────────────────
     Hovering or focusing a card's category, rubric or Core Competency chip
     shows its name and a plain sentence in the shared #gb-tooltip, which is
     fixed to the window so no scrolling box clips it. */
  pageState._chipTipSource = null;
  pageState._nameTipTimer = null;

  /* ── The assessment form's hover-overs (redesign PR 13) ──────────
     Each answers the question a teacher has at that field, from data the
     class already holds, in the shared #gb-tooltip: a chosen competency, a
     Codes folder, the rubric, the Factor and a Core Competency. Category,
     Date Assigned and List rows have none (Colin, Nov 2). On hover (under the field) and keyboard focus (over it when
     there's room, so the next field stays in view). */
  pageState._afTipSource = null;

  // The Ministry's Core Competency descriptions load the first time they're needed.
  pageState._afCoreLoading = null;

  /* An open New or Edit Assessment form is kept as the teacher has it
     through a redraw of the page. A data refresh waits for the teacher to
     leave a field, then redraws: rebuilding the form there blanked it (title,
     dates and scoring back to the defaults, a Blank Rubric's name gone), and
     the click that left the field (Points, Complete/Incomplete, a Category)
     landed on the old form. A form drawn for another class is not kept. */
  pageState._keepingForm = false;

  /* ── Assessment Form ────────────────────────────────────── */
  // One row of the competency checklist. The row reads the competency's own
  // wording; the section name (often just the category) is the last fallback.
  pageState._afIcanSeq = 0;

  /* ── Student Work on the assessment form (S5-F1) ───────────
     Board "Teacher: Student Work Settings on an Assessment", without Keep
     Photos Until (per class only, Q15). The card is drawn only while the
     class's Send Work is on (CmStudentPage.workSettings), in Demo Mode or
     a signed-in class with its student page on (S5-W1). The choices are
     saved by saveAssessmentStudentWork (shared/data.js): Demo Mode keeps
     them with its sample work, a signed-in class sends what changed
     (set_assessment_student_work). Group Work and Students See Your Mark
     Up are drawn in Demo Mode only until Batch C is wired. They are kept
     by the assessment's id, not on the assessment: so Copy Assessment,
     Duplicate, Copy to Another Class and Duplicate Class all start the
     copy at Nothing (Colin). After the Due Date starts at Keep Accepting
     (Colin); Until is the last day work is taken, a week after the due
     date until the teacher picks another. */
  pageState._formWork = null; // the open form's Student Work choices, or null when the card is not drawn
  pageState._formSeedDue = ''; // the due date the form was drawn with, until it is in the page
  if (window.QuizBuilder)
    QuizBuilder.redrawWith(_refreshFormWorkCard, {
      afterDueRow: _afterDueRowHtml,
      untilDefault: _formWorkUntilDefault,
    });

  /* ── Handouts and Links on the assessment form ─────────────
     Board "3a. A Handout and Two Links, Adding a Link": under the
     Description, the handout (a PDF, at most 20 pages, turned into pages
     on this computer as Add Work's are) and links students open from the
     assignment's card. Drawn only in a class whose student page is on
     (the Description hint's test) and that can keep them
     (assessmentResourcesOffered, shared/data.js). What is added or
     removed here is saved with the assessment: for a new one, after it
     exists, as Student Work's choices are (_saveFormRes). Kept by the
     assessment's id, so a copy starts with none.
     + Add a File (Colin, Nov 17 2026) takes a PDF, which becomes pages as
     before, or a web page, a text file or an EPUB, kept as it is, 20 MB at
     most (shared/handout-files.js). A web page is chosen together with its
     pictures; the field says which pictures it names were not chosen. */
  pageState._formRes = null; // { cid, aid, items, linkOpen, busy, msg, next } while the field is drawn
  AssignForm.configure({
    AC: AC,
    COMPETENCIES_NEED_TAG_HINT: COMPETENCIES_NEED_TAG_HINT,
    DUE_BEFORE_ASSIGNED_HINT: DUE_BEFORE_ASSIGNED_HINT,
    SCORE_MODE_CARDS: SCORE_MODE_CARDS,
  });
  /* Shows the Category field's hint while scored work in a class with
     categories has none chosen; true when it shows. A choice clears the
     red outline a stopped save left. */
  pageState._categoryTried = false; // a save stopped for a category since the form opened

  /* Ctrl/⌘+Enter in the form creates the assessment (or saves the edit). */
  /* What the form holds, field by field, to tell what the teacher changed:
     taken when the form opens, compared on Save Changes (fields left alone
     keep their stored value) and on Cancel (asks only when something
     changed). Classes to copy to are not part of it. */
  pageState._formStart = null;

  /* ── Rubric starts in place (rubric starts plan, PR 3) ──────────
     A start opens under its button, joined to it, as a card in the
     Competency Rubric's look: grey head with the title and buttons, the
     body, a grey footer line. One is open at a time; Close, Esc, another
     start, or a scoring mode without a rubric closes it. */
  pageState._startOpen = null;
  pageState._choose = { query: '', selected: null };

  /* ── Copy From Another Class, in place (rubric starts PR 4) ──────
     Any of the teacher's other live classes. A class linked to the same
     curriculum brings its competencies with the copy (matched as
     Copy Grading Setup and assessment copies match them); from any other,
     the copy brings its criteria and wording only (Colin, Nov 2). The copy
     is held like any rubric made on the form, saved when the assessment is. */
  pageState._copy = { from: null, selected: null };

  /* ── Blank Rubric: the compact editor, in place (rubric starts PR 5) ─
     The rubric editor's parts laid out as the Competency Rubric's grid: the
     name and Standard / Advanced / Single-Point in the head; a row per
     criterion with its level cells typed straight into; + Competency and a
     ··· menu (weight, points per level, remove) under each name; + Add
     Criterion and + From Competency on the footer line. Open by default on
     a new assessment. Save Rubric holds the rubric like any made on the
     form; Create holds a touched blank on its own, and an untouched one is
     never saved. Edit Rubric on a held rubric opens it here. */
  pageState._blank = null;
  pageState._afHoverTimer = null;
  function _byKeyboard(e) {
    return !!(e.target && e.target.matches && e.target.matches(':focus-visible'));
  }

  function saveNewAssess(how) {
    var addAnother = how === true;
    if (_formResBusy()) return;
    var titleEl = document.getElementById('af-title');
    var title = (titleEl ? titleEl.value : '').trim();
    if (!title) {
      if (titleEl) {
        titleEl.setAttribute('aria-invalid', 'true');
        titleEl.placeholder = 'Title is required';
        titleEl.focus();
      }
      return;
    }
    if (!_formCategoryChosen()) return;
    if (window.QuizBuilder && !QuizBuilder.formOk()) return;
    if (!_formMaxPointsOk()) return;
    if (!_formCompetencyTagged()) return;
    if (
      _commitOpenBlank(function () {
        saveNewAssess(how);
      })
    )
      return;
    // A rubric made for this assessment is saved now, then the assessment
    // with the rubric's saved id (redesign PR 8).
    if (
      _persistPendingFormRubric(function () {
        saveNewAssess(how);
      })
    )
      return;
    var dateAssigned = (document.getElementById('af-date-assigned') || {}).value || courseToday(pageState.activeCourse);
    var date = dateAssigned;
    var description = (document.getElementById('af-desc') ? document.getElementById('af-desc').value : '').trim();
    var tagIds = Array.from(document.querySelectorAll('.af-tag-cb:checked')).map(function (cb) {
      return cb.value;
    });
    var evidence = (document.getElementById('af-evidence') || {}).value;
    var categoryId = (document.getElementById('af-category') || {}).value || '';
    var moduleId = (document.getElementById('af-module') || {}).value || '';
    var coreCompetencyIds = Array.from(document.querySelectorAll('.af-cc-chip.active')).map(function (el) {
      return el.dataset.cc;
    });
    var assessments = getAssessments(pageState.activeCourse);
    var id = uid();
    var rubricId = (document.getElementById('af-rubric') || {}).value || '';
    var dueDate = (document.getElementById('af-due') || {}).value || '';
    var newAssess = {
      id: id,
      title: title,
      date: date,
      dateAssigned: dateAssigned,
      type: 'summative',
      tagIds: tagIds,
      evidenceType: evidence,
      description: description,
      notes: '',
      created: new Date().toISOString(),
    };
    if (how === 'draft') newAssess.isDraft = true;
    if (categoryId) {
      newAssess.categoryId = categoryId;
      newAssess.category_id = categoryId;
    }
    if (dueDate) newAssess.dueDate = dueDate;
    if (moduleId) newAssess.moduleId = moduleId;
    // Only proficiency work is scored on a rubric; a rubric picked before
    // switching to Points or Complete/Incomplete isn't saved with it.
    var formMode = (document.getElementById('af-scoremode') || {}).value || 'proficiency';
    if (rubricId && formMode === 'proficiency') newAssess.rubricId = rubricId;
    if (coreCompetencyIds.length > 0) newAssess.coreCompetencyIds = coreCompetencyIds;
    if (pageState.newCollaboration !== 'individual') newAssess.collaboration = pageState.newCollaboration;
    if (pageState.collabExcluded.size > 0) newAssess.excludedStudents = Array.from(pageState.collabExcluded);
    if (pageState.newCollaboration === 'pair' && pageState.collabPairs.length > 0)
      newAssess.pairs = pageState.collabPairs;
    if (pageState.newCollaboration === 'group') {
      if (pageState.collabGroups.length > 0) newAssess.groups = pageState.collabGroups;
      newAssess.groupCount = pageState.collabGroupCount;
    }
    var scoreModeVal = (document.getElementById('af-scoremode') || {}).value || 'proficiency';
    if (scoreModeVal === 'points') {
      newAssess.scoreMode = 'points';
      newAssess.maxPoints = _formMaxPoints();
    } else if (scoreModeVal === 'complete') {
      newAssess.scoreMode = 'complete';
      newAssess.maxPoints = COMPLETE_MAX_POINTS;
    } else if (scoreModeVal === 'dibels') {
      newAssess.scoreMode = 'dibels';
    }
    var assessWeight = _formAssessWeight();
    if (assessWeight !== 1) newAssess.weight = assessWeight;
    if (FactorField.factoredOn(document)) newAssess.studentsSeeFactored = true;
    // Read before render() replaces the form.
    var copyTargets = window.AssessmentCopy ? AssessmentCopy.readTargets(pageState.activeCourse) : [];
    if (copyTargets.length) newAssess.copyGroup = AssessmentCopy.newCopyGroup();
    var formWork = pageState._formWork;
    var formRes = pageState._formRes;
    var srcCid = pageState.activeCourse;
    assessments.push(newAssess);
    saveAssessments(pageState.activeCourse, assessments);
    _saveFormWork(pageState.activeCourse, id, formWork);
    if (window.QuizBuilder) QuizBuilder.save(pageState.activeCourse, id);
    _saveFormRes(pageState.activeCourse, id, formRes);
    var keep = addAnother ? _formKeepForNext() : null;
    pageState.openAssessIds.clear();
    pageState.openAssessIds.add(id);
    pageState._showingNewForm = false;
    pageState._editingAssessId = null;
    render();
    if (keep) {
      _reopenWith(keep);
      var saved = document.getElementById('af-saved-note');
      if (saved) {
        saved.textContent = 'Created ' + title + '.';
        saved.hidden = false;
      }
    }
    // Once the copies exist, the card can show "Also in …". A form reopened
    // for the next one stays open through that render.
    if (copyTargets.length)
      AssessmentCopy.copyToClasses(srcCid, newAssess, copyTargets).then(function () {
        // A form reopened for the next one is left as the teacher has it;
        // the "Also in …" chips show at the next render.
        if (keep && pageState._showingNewForm && !pageState._editingAssessId) return;
        render();
      });
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
      if (!pageState.collapsedModules[folders[f].dataset.moduleId]) continue;
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

  /* ── Scoring Functions ──────────────────────────────────── */
  // html-safe: marks and labels are constants; aid and sid are our ids
  function completionButtonsHtml(aid, sid, mark) {
    return (
      '<span class="ldg-seg" role="group" aria-label="Mark">' +
      ['complete', 'incomplete']
        .map(function (m) {
          return (
            '<button type="button" class="cmp-btn cmp-' +
            m +
            (mark === m ? ' active' : '') +
            '" aria-pressed="' +
            (mark === m) +
            '" tabindex="-1" data-action="setCompletion" data-mark="' +
            m +
            '" data-aid="' +
            aid +
            '" data-sid="' +
            sid +
            '">' +
            (m === 'complete' ? _CMP_ICON_COMPLETE + 'Complete' : _CMP_ICON_INCOMPLETE + 'Incomplete') +
            '</button>'
          );
        })
        .join('') +
      '</span>'
    );
  }

  // A filled circle in the mark's colour; white on the chosen capsule.
  var _CMP_ICON_COMPLETE =
    '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" class="cmp-icon-bg"/><path d="M7.5 12.5l3 3 6-6.5" fill="none" class="cmp-icon-mark" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var _CMP_ICON_INCOMPLETE =
    '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" class="cmp-icon-bg"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" fill="none" class="cmp-icon-mark" stroke-width="2.4" stroke-linecap="round"/></svg>';

  /* ── Ledger rows (Complete/Incomplete and points) ───────────
     One line per student: Name · Mark · Status · Comment. The rubric and
     proficiency grids keep their own layout (renderStatusToggles). */
  var LEDGER_STATUSES = [
    ['NS', 'Missing', 'active-ns'],
    ['EXC', 'Excused', 'active-excused'],
    ['LATE', 'Late', 'active-late'],
  ];

  // Missing | Excused | Late as one segmented control, like the grader's.
  function ledgerStatusHtml(aid, sid, current) {
    return (
      '<div class="ldg-status grader-status" role="group" aria-label="Status">' +
      LEDGER_STATUSES.map(function (s) {
        var on = current === s[0];
        return (
          '<button type="button" class="grader-status-btn ldg-chip' +
          (on ? ' ' + s[2] + ' is-on is-' + s[0].toLowerCase() : '') +
          '" aria-pressed="' +
          on +
          '" tabindex="-1" data-action="toggleStudentStatus" data-aid="' +
          aid +
          '" data-sid="' +
          sid +
          '" data-status="' +
          s[0] +
          '" data-stop-prop="true"' +
          _statusLockAttrs(aid, sid, s[0]) +
          '>' +
          s[1] +
          '</button>'
        );
      }).join('<span class="grader-status-sep" aria-hidden="true"></span>') +
      '</div>'
    );
  }

  /* The row's Overall Comment: the grid's field, in the row after the
     status (rsgOverallComment saves it). */
  function ledgerOverallCommentHtml(cid, aid, st) {
    return (
      '<div class="ldg-overall">' +
      _overallCommentFieldHtml(cid, aid, st, 'rsg-overall-comment ldg-overall-comment') +
      '</div>'
    );
  }

  function ledgerRowOpen(kind, aid, st, stStatus) {
    var disableRow = stStatus && stStatus !== 'LATE';
    // Draft or Returned beside the name (S1-F2); '' in a class that holds
    // no grades, where the row is as it was.
    var mark = _returnMarkHtml(pageState.activeCourse, aid, st.id);
    var group = _groupRowFor(aid, st.id);
    // The work icon, as on a rubric's or competencies' rows (Colin, Nov 16:
    // every kind of work takes Add Work and See the Work). A group's row
    // has none, as there.
    var work = group && group.view ? '' : _workIconHtml(pageState.activeCourse, aid, st);
    var wrap = mark || work;
    return (
      '<div class="score-row ldg-row ldg-' +
      kind +
      (disableRow ? ' has-status' : '') +
      (stStatus === 'LATE' ? ' has-late' : '') +
      '"' +
      (kind === 'cmp' ? ' tabindex="0"' : '') +
      ' data-status-student="' +
      st.id +
      '" data-status-assess="' +
      aid +
      '">' +
      '<span class="ldg-name' +
      (wrap ? ' ldg-name-ret' : '') +
      (work ? ' ldg-name-work' : '') +
      '">' +
      (wrap ? '<span class="ldg-name-text">' : '') +
      esc(group && group.view ? group.view.label : displayNameWithLast(st)) +
      (wrap ? '</span>' + mark + work : '') +
      '</span>'
    );
  }

  /* Class Results (teacher/class-results.js) opens from a card's header and
     from the class line under its scores; class-results.js listens for
     data-action="classResults". */
  var _CLASS_RESULTS_ICON =
    '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 16v-3"/><path d="M8 16v-6"/><path d="M12 16v-9"/><path d="M16 16V4"/></svg>';
  function _classResultsAttrs(cid, aid) {
    return (
      ' data-action="classResults" data-cid="' + esc(cid) + '" data-aid="' + esc(aid) + '" title="View Class Results"'
    );
  }
  function _classResultsLinkHtml(cid, aid) {
    return (
      '<button type="button" class="ldg-name cr-ldg-link"' + _classResultsAttrs(cid, aid) + '>Class Results</button>'
    );
  }
  // The open panel follows the page's changes, once per frame.
  pageState._crRefreshQueued = false;
  function _refreshClassResultsSoon() {
    if (pageState._crRefreshQueued || !window.ClassResults || !ClassResults.isOpen()) return;
    pageState._crRefreshQueued = true;
    requestAnimationFrame(function () {
      pageState._crRefreshQueued = false;
      if (window.ClassResults && ClassResults.isOpen()) ClassResults.refresh();
    });
  }

  // Counts read from the rows on screen, so they follow every click without a re-render.
  function refreshLedgerSummary(grid) {
    if (!grid) return;
    var rows = grid.querySelectorAll('.ldg-row');
    var tally = grid.querySelector('.ldg-tally');
    if (!tally) return;
    if (grid.classList.contains('cmp-grid')) {
      var n = { c: 0, i: 0, u: 0 };
      rows.forEach(function (r) {
        if (r.classList.contains('has-status')) return;
        if (r.querySelector('.cmp-complete.active')) n.c++;
        else if (r.querySelector('.cmp-incomplete.active')) n.i++;
        else n.u++;
      });
      // html-safe: the three counts are numbers; the class and assessment ids are escaped
      tally.innerHTML =
        '<span><b>' +
        n.c +
        '</b> Complete</span><span><b>' +
        n.i +
        '</b> Incomplete</span><span><b>' +
        n.u +
        '</b> Unmarked</span>' +
        (grid.dataset.aid ? _classResultsLinkHtml(pageState.activeCourse, grid.dataset.aid) : '');
      _refreshClassResultsSoon();
      return;
    }
    var max = parseFloat(grid.dataset.max) || 100;
    var vals = [];
    var left = 0;
    // Missing counts as 0 in the Average, as in the course % and the
    // gradebook's Class Average (classColumnAverage); Excused is left out.
    var missing = 0;
    rows.forEach(function (r) {
      if (r.classList.contains('has-status')) {
        if (r.querySelector('[data-status="NS"][aria-pressed="true"]')) missing++;
        return;
      }
      var inp = r.querySelector('.gb-pts-input');
      var v = inp ? parsePointsInput(inp.value, max) : null;
      if (v == null) left++;
      else vals.push(v);
    });
    var html = '<span><b>' + vals.length + '</b> Marked</span><span><b>' + left + '</b> Unmarked</span>';
    var stats = grid.querySelector('.ldg-stats');
    // Median, Lowest and Highest count Missing as 0 too, so the line uses
    // one rule (Nov 3 sweep: the Average counted it, the rest left it out).
    var counted = vals.slice();
    for (var m = 0; m < missing; m++) counted.push(0);
    if (counted.length) {
      var sorted = counted.slice().sort(function (x, y) {
        return x - y;
      });
      var sum = counted.reduce(function (x, y) {
        return x + y;
      }, 0);
      // calc.js's median, so this line and Class Results agree.
      var mid = medianOf(counted);
      html += '<span>Average <b>' + formatPointsPercent(sum / counted.length, max) + '</b></span>';
      if (stats)
        // html-safe: figures from formatPoints; the class and assessment ids are escaped
        stats.innerHTML =
          (grid.dataset.aid
            ? _classResultsLinkHtml(pageState.activeCourse, grid.dataset.aid)
            : '<span class="ldg-name">Class</span>') +
          '<span>Median <b>' +
          formatPoints(mid) +
          ' / ' +
          max +
          '</b></span><span>Lowest <b>' +
          formatPoints(sorted[0]) +
          ' / ' +
          max +
          '</b></span><span>Highest <b>' +
          formatPoints(sorted[sorted.length - 1]) +
          ' / ' +
          max +
          '</b></span>';
    } else if (stats) stats.innerHTML = '';
    tally.innerHTML = html;
    _refreshClassResultsSoon();
  }

  function renderCompletionGrid(cid, a, students) {
    var statuses = getAssignmentStatuses(cid);
    var html =
      '<div class="ldg-grid cmp-grid" data-aid="' +
      a.id +
      '">' +
      '<div class="ldg-bar"><span class="ldg-tally"></span>' +
      '<div class="ldg-actions"><button type="button" class="ldg-action" data-action="confirmFillNotSubmitted" data-aid="' +
      a.id +
      '">Set Unmarked to Missing</button>' +
      '<button type="button" class="ldg-action cmp-fill-all" data-action="confirmFillCompletion" data-aid="' +
      a.id +
      '">Set Unmarked to Complete</button></div></div>' +
      '<div class="ldg-head"><span>Student</span><span>Mark</span><span>Status</span><span>Overall Comment</span></div>';
    students.forEach(function (st) {
      var stStatus = statuses[st.id + ':' + a.id] || null;
      html +=
        ledgerRowOpen('cmp', a.id, st, stStatus) +
        '<div class="cmp-cell">' +
        completionButtonsHtml(a.id, st.id, getCompletionMark(cid, st.id, a.id)) +
        '</div>' +
        _ledgerStatusOrNoteHtml(a.id, st.id, stStatus) +
        ledgerOverallCommentHtml(cid, a.id, st) +
        '</div>' +
        _ledgerMembersHtml(cid, a.id, st.id);
    });
    html += '</div>';
    return html;
  }

  /* Complete/Incomplete rows answer single keys while the row has focus:
     C and I mark and move down, L toggles Late, M opens comments, arrows move. */
  function handleLedgerKey(e, row) {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    var step = function (dir) {
      var n = dir > 0 ? row.nextElementSibling : row.previousElementSibling;
      if (n && n.classList.contains('ldg-row')) n.focus();
    };
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      step(k === 'ArrowDown' ? 1 : -1);
      return true;
    }
    var target = null;
    if (k === 'c') target = row.querySelector('.cmp-complete');
    else if (k === 'i') target = row.querySelector('.cmp-incomplete');
    else if (k === 'l') target = row.querySelector('.ldg-chip[data-status="LATE"]');
    else if (k === 'm') target = row.querySelector('.ldg-note');
    if (!target) return false;
    e.preventDefault();
    target.click();
    if (k === 'c' || k === 'i') step(1);
    else if (k === 'l') row.focus();
    return true;
  }

  // Clicking the active mark again clears it.
  function setCompletion(el) {
    var cid = pageState.activeCourse;
    var aid = el.dataset.aid;
    var sid = el.dataset.sid;
    var next = getCompletionMark(cid, sid, aid) === el.dataset.mark ? null : el.dataset.mark;
    // Missing and Excused work takes no mark (isScoreLocked); C and I reach here by key.
    if (next && isScoreLocked(cid, sid, aid)) return;
    Grader.setMark(cid, sid, aid, next);
    var cell = el.closest('.cmp-cell');
    var grid = el.closest('.ldg-grid');
    if (cell) cell.innerHTML = completionButtonsHtml(aid, sid, next);
    refreshLedgerSummary(grid);
    refreshSidebarGrades(sid);
  }

  function confirmFillCompletion(aid) {
    showConfirm(
      'Set Unmarked to Complete',
      'Set every unmarked student to Complete?',
      'Set to Complete',
      'primary',
      function () {
        var cid = pageState.activeCourse;
        var prevScores = structuredClone(getScores(cid));
        var statuses = getAssignmentStatuses(cid);
        getStudents(cid).forEach(function (st) {
          if (statuses[st.id + ':' + aid] || getCompletionMark(cid, st.id, aid)) return;
          Grader.setMark(cid, st.id, aid, 'complete');
        });
        render();
        refreshSidebarGrades();
        var filled = structuredClone(getScores(cid));
        showUndoToast('Unmarked students set to Complete', function () {
          Grader.undo(cid, prevScores, filled);
          render();
          refreshSidebarGrades();
        });
      },
    );
  }

  function renderPointsGrid(cid, a, students, scores) {
    var max = Number(a.maxPoints) || 100;
    var statuses = getAssignmentStatuses(cid);
    var html =
      '<div class="ldg-grid pts-grid" data-aid="' +
      a.id +
      '" data-max="' +
      max +
      '">' +
      '<div class="ldg-bar"><span class="ldg-tally"></span>' +
      '<div class="ldg-actions"><button type="button" class="ldg-action" data-action="confirmFillNotSubmitted" data-aid="' +
      a.id +
      '">Set Unmarked to Missing</button>' +
      '<button type="button" class="ldg-action" data-action="confirmFillPoints" data-aid="' +
      a.id +
      '">Set Unmarked to ' +
      max +
      ' / ' +
      max +
      '</button></div></div>';
    students.forEach(function (st) {
      var raw = getPointsScore(cid, st.id, a.id);
      var stStatus = statuses[st.id + ':' + a.id] || null;
      var disableRow = stStatus && stStatus !== 'LATE';
      html +=
        ledgerRowOpen('pts', a.id, st, stStatus) +
        '<div class="pts-input-cell">' +
        '<input type="text" class="gb-pts-input ldg-pts-input" inputmode="decimal" autocomplete="off" aria-label="Score for ' +
        esc(displayNameWithLast(st)) +
        '" value="' +
        (raw != null ? formatPoints(raw) : '') +
        '" data-sid="' +
        st.id +
        '" data-aid="' +
        a.id +
        '" data-max="' +
        max +
        '"' +
        (disableRow ? ' disabled' : '') +
        '>' +
        '<span class="gb-pts-max">/ ' +
        max +
        '</span>' +
        FactorField.chipHtml(a, raw, max) +
        '<span class="gb-pts-live-pct">' +
        pointsPctHtml(raw, max, 0) +
        '</span>' +
        '</div>' +
        _ledgerStatusOrNoteHtml(a.id, st.id, stStatus) +
        ledgerOverallCommentHtml(cid, a.id, st) +
        '</div>' +
        _ledgerMembersHtml(cid, a.id, st.id);
    });
    html += '<div class="ldg-stats"></div>' + '</div>';
    return html;
  }

  // Every student with no score and no status becomes Missing, with undo.
  function confirmFillNotSubmitted(aid) {
    showConfirm(
      'Set Unmarked to Missing',
      'Set every unmarked student to Missing?',
      'Set to Missing',
      'primary',
      function () {
        var cid = pageState.activeCourse;
        var statuses = getAssignmentStatuses(cid);
        var marked = [];
        getStudents(cid).forEach(function (st) {
          if (statuses[st.id + ':' + aid] || getPointsScore(cid, st.id, aid) != null) return;
          if (!canSetAssignmentStatus(cid, st.id, aid, 'NS')) return;
          Grader.setStatus(cid, st.id, aid, 'NS');
          marked.push(st.id);
        });
        render();
        refreshSidebarGrades();
        if (!marked.length) return;
        showUndoToast('Unmarked students set to Missing', function () {
          marked.forEach(function (sid) {
            Grader.undoMissing(cid, sid, aid);
          });
          render();
          refreshSidebarGrades();
        });
      },
    );
  }

  function confirmFillPoints(aid) {
    var cid = pageState.activeCourse;
    var a = getAssessments(cid).find(function (x) {
      return x.id === aid;
    });
    if (!a) return;
    var max = a.maxPoints || 100;
    var label = max + ' / ' + max;
    showConfirm(
      'Set Unmarked to ' + label,
      'Set every unmarked student to ' + label + '?',
      'Set to ' + label,
      'primary',
      function () {
        var prevScores = structuredClone(getScores(cid));
        var statuses = getAssignmentStatuses(cid);
        getStudents(cid).forEach(function (st) {
          // Same rule as Set Unmarked to Complete: any status, Late included, is left alone.
          if (statuses[st.id + ':' + aid] || getPointsScore(cid, st.id, aid) != null) return;
          Grader.setPoints(cid, st.id, aid, max);
        });
        render();
        refreshSidebarGrades();
        var filled = structuredClone(getScores(cid));
        showUndoToast('Unmarked students set to ' + label, function () {
          Grader.undo(cid, prevScores, filled);
          render();
          refreshSidebarGrades();
        });
      },
    );
  }

  function livePointsUpdate(inp) {
    var max = parseFloat(inp.dataset.max) || 100;
    var pctSpan = inp.closest('.score-row').querySelector('.gb-pts-live-pct');
    if (pctSpan) pctSpan.innerHTML = pointsPctHtml(parsePointsInput(inp.value, max), max, 0);
    FactorField.refreshChip(inp.closest('.score-row'), parsePointsInput(inp.value, max), max);
  }
  function commitPointsScore(inp) {
    var cid = pageState.activeCourse;
    var sid = inp.dataset.sid;
    var aid = inp.dataset.aid;
    var max = parseFloat(inp.dataset.max) || 100;
    // A typo that isn't a number puts the saved score back; only a blank
    // box clears.
    var prev = getPointsScore(cid, sid, aid);
    var over = _pointsOverLimit(inp.value, max);
    var raw = parsePointsInput(inp.value, max, prev);
    inp.value = raw != null ? formatPoints(raw) : '';
    // Leaving a field without changing it saves nothing; an untouched blank
    // field used to write a 0. A typed 0 is a score; blank clears.
    if (raw === prev) return;
    // Grader.setPoints saves the one score, as the gradebook and phone do. A
    // second write under the assessment's own id left a stray entry and
    // sent the score twice.
    Grader.setPoints(cid, sid, aid, raw);
    livePointsUpdate(inp); // the % and the factored score, from the box as saved
    refreshLedgerSummary(inp.closest('.ldg-grid'));
    if (over != null) _sayPointsCapped(cid, sid, aid, over, raw, max, prev);
  }
  /* Extra credit goes up to twice the maximum (D4), and a score typed above
     that is saved at the limit. That used to happen without a word, so a
     typo such as 45 for 4.5 became a perfect double score (Nov 3 sweep).
     The toast says what was saved, and Undo puts back the score before. */
  function _pointsOverLimit(text, max) {
    var n = parseFloat(
      String(text == null ? '' : text)
        .trim()
        .replace(',', '.'),
    );
    return max > 0 && isFinite(n) && n > max * POINTS_EXTRA_CREDIT_FACTOR ? n : null;
  }
  function _sayPointsCapped(cid, sid, aid, typed, saved, max, prev) {
    _showFillUndo(
      formatPoints(typed) +
        ' is more than twice the ' +
        formatPoints(max) +
        '-point maximum, so it was saved as ' +
        formatPoints(saved) +
        '.',
      function () {
        Grader.setPoints(cid, sid, aid, prev);
        render();
        refreshSidebarGrades(sid);
      },
    );
  }
  // The next (or previous) score box that is open for typing.
  function focusPointsBox(row, dir) {
    var r = row;
    while ((r = dir > 0 ? r.nextElementSibling : r.previousElementSibling)) {
      var box = r.querySelector && r.querySelector('.gb-pts-input');
      if (box && !box.disabled) {
        box.focus();
        box.select();
        return;
      }
    }
  }
  var POINTS_STATUS_KEYS = { l: 'LATE', e: 'EXC', n: 'NS' };
  function handlePointsKey(e, inp) {
    var statusKey = !e.metaKey && !e.ctrlKey && !e.altKey && POINTS_STATUS_KEYS[e.key.toLowerCase()];
    if (statusKey) {
      // L, E or N in a score box: keep any number typed, then set Late,
      // Excused or Not Submitted. Excused and Not Submitted lock the box,
      // so focus moves on to the next open one.
      e.preventDefault();
      var srow = inp.closest('.score-row');
      var chip = srow && srow.querySelector('.ldg-chip[data-status="' + statusKey + '"]');
      if (!chip) return;
      commitPointsScore(inp);
      chip.click();
      if (inp.disabled) focusPointsBox(srow, 1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commitPointsScore(inp);
      focusPointsBox(inp.closest('.score-row'), 1);
    } else if (e.key === 'Escape') {
      var raw = getPointsScore(pageState.activeCourse, inp.dataset.sid, inp.dataset.aid);
      inp.value = raw != null ? formatPoints(raw) : '';
      inp.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      var next = inp.closest('.score-row').nextElementSibling;
      if (next) {
        var ni = next.querySelector('.gb-pts-input');
        if (ni) {
          ni.focus();
          ni.select();
        }
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      var prev = inp.closest('.score-row').previousElementSibling;
      if (prev) {
        var pi = prev.querySelector('.gb-pts-input');
        if (pi) {
          pi.focus();
          pi.select();
        }
      }
    }
  }

  function renderStatusToggles(aid, sid, currentStatus) {
    var cid = pageState.activeCourse;
    var commentCount = _assignmentCommentCount(cid, sid, aid);
    return (
      '<div class="student-status-toggles">' +
      '<button class="student-status-btn' +
      (currentStatus === 'EXC' ? ' active-excused' : '') +
      '" tabindex="-1" data-action="toggleStudentStatus" data-aid="' +
      aid +
      '" data-sid="' +
      sid +
      '" data-status="EXC" data-stop-prop="true" title="Excused">EXC</button>' +
      '<button class="student-status-btn' +
      (currentStatus === 'NS' ? ' active-ns' : '') +
      '" tabindex="-1" data-action="toggleStudentStatus" data-aid="' +
      aid +
      '" data-sid="' +
      sid +
      '" data-status="NS" data-stop-prop="true" title="Missing">M</button>' +
      '<button class="comment-btn" data-action="openCommentPopover" data-cid="' +
      cid +
      '" data-sid="' +
      sid +
      '" data-aid="' +
      aid +
      '" data-stop-prop="true" title="Comments">Comment' +
      (commentCount > 0 ? ' <span class="comment-count">' + commentCount + '</span>' : '') +
      '</button>' +
      '</div>' +
      '<div class="student-status-toggles student-status-row2">' +
      '<button class="student-status-btn student-status-late' +
      (currentStatus === 'LATE' ? ' active-late' : '') +
      '" tabindex="-1" data-action="toggleStudentStatus" data-aid="' +
      aid +
      '" data-sid="' +
      sid +
      '" data-status="LATE" data-stop-prop="true" title="Late">LATE</button>' +
      '</div>'
    );
  }

  function toggleStudentStatus(aid, sid, status) {
    var debounceKey = sid + ':' + aid + ':' + status;
    if (pageState._statusDebounce[debounceKey]) return;
    pageState._statusDebounce[debounceKey] = true;
    setTimeout(function () {
      delete pageState._statusDebounce[debounceKey];
    }, 300);
    var cid = pageState.activeCourse;
    var current = getAssignmentStatus(cid, sid, aid);
    var newStatus = current === status ? null : status;
    if (!canSetAssignmentStatus(cid, sid, aid, newStatus)) return;
    var clearedScores = Grader.setStatus(cid, sid, aid, newStatus);
    var row =
      document.querySelector('.score-row[data-status-student="' + sid + '"][data-status-assess="' + aid + '"]') ||
      document.querySelector('.rsg-student[data-status-student="' + sid + '"][data-status-assess="' + aid + '"]');
    if (row) {
      row.querySelectorAll('.student-status-btn, .ldg-chip').forEach(function (btn) {
        btn.classList.remove('active-excused', 'active-ns', 'active-late');
        if (btn.classList.contains('ldg-chip'))
          btn.setAttribute('aria-pressed', String(btn.dataset.status === newStatus));
      });
      // The grid's Missing | Excused | Late control.
      row.querySelectorAll('.grader-status-btn').forEach(function (btn) {
        var on = btn.dataset.status === newStatus;
        btn.classList.remove('is-on', 'is-ns', 'is-exc', 'is-late');
        if (on) btn.classList.add('is-on', 'is-' + newStatus.toLowerCase());
        btn.setAttribute('aria-pressed', String(on));
      });
      if (newStatus === 'EXC') row.querySelector('[data-status="EXC"]').classList.add('active-excused');
      else if (newStatus === 'NS') row.querySelector('[data-status="NS"]').classList.add('active-ns');
      else if (newStatus === 'LATE') row.querySelector('[data-status="LATE"]').classList.add('active-late');
      // Late doesn't disable scoring — student submitted, just late
      var disableScoring = newStatus && newStatus !== 'LATE';
      if (disableScoring) row.classList.add('has-status');
      else row.classList.remove('has-status');
      if (newStatus === 'LATE') row.classList.add('has-late');
      else row.classList.remove('has-late');
      var ptsInput = row.querySelector('.gb-pts-input');
      if (ptsInput) ptsInput.disabled = disableScoring;
      if (clearedScores) {
        row.querySelectorAll('.score-opt, .rsg-level, .cmp-btn').forEach(function (el) {
          el.classList.remove('active', 'mixed');
        });
        row.querySelectorAll('.rsg-criterion-row').forEach(syncModRow);
      }
      refreshLedgerSummary(row.closest('.ldg-grid'));
      // DIBELS counts leave out Missing and Excused students.
      if (row.closest('.dbl-grid')) render();
    } else if (!pageState._grader && document.querySelector('.grader-inline')) {
      // One student's grader on the page: redraw its status, lock and grade.
      render();
    }
    // Group work: a member's status can change which member the group's
    // rows come from, and the strip has no row of its own to update.
    if (!pageState._grader && _groupRows[aid]) render();
    refreshSidebarGrades(sid);
  }

  /* ── + / − on a proficiency level ───────────────────────── */
  // The level and modifier a grading row's entries share. A rubric criterion
  // whose tags disagree is mixed and takes no +/−.
  function rowScoreState(row) {
    var aid = row.dataset.assess;
    var tagIds = [];
    if (row.dataset.tag) tagIds = _tagScoreKeys(pageState.activeCourse, aid, row.dataset.tag);
    else {
      var crit = getRubricCriterion(aid, row.dataset.criterion);
      if (crit) tagIds = rubricCriterionScoreKeys(crit);
    }
    var entries = getScores(pageState.activeCourse)[row.dataset.student] || [];
    var states = [];
    tagIds.forEach(function (tid) {
      var e = entries.find(function (s) {
        return s.assessmentId === aid && s.tagId === tid;
      });
      if (e && e.score > 0) states.push({ level: e.score, mod: normalizeScoreMod(e.score, e.mod) });
    });
    var mixed = states.some(function (st) {
      return st.level !== states[0].level || st.mod !== states[0].mod;
    });
    var shared = states.length && !mixed ? states[0] : { level: 0, mod: 0 };
    return { level: shared.level, mod: shared.mod, mixed: mixed, tagIds: tagIds };
  }

  function scoreModButtonsHtml(level, mod) {
    return [-1, 1]
      .map(function (m) {
        var allowed = level > 0 && normalizeScoreMod(level, m) === m;
        return (
          '<button type="button" class="rsg-mod' +
          (level > 0 ? ' l' + level : '') +
          (allowed && mod === m ? ' active' : '') +
          '" data-action="setScoreMod" data-stop-prop="true" tabindex="-1" data-mod="' +
          m +
          '" aria-label="' +
          (m > 0 ? 'Plus' : 'Minus') +
          '" aria-pressed="' +
          (allowed && mod === m) +
          '" title="' +
          (m > 0 ? 'Plus (+)' : 'Minus (\u2212)') +
          '"' +
          (allowed ? '' : ' disabled') +
          '>' +
          scoreModSuffix(m) +
          '</button>'
        );
      })
      .join('<span class="rsg-mod-sep" aria-hidden="true"></span>');
  }

  /* A level button's contents. The chosen level carries its − | + inside
     it, as an Advanced rubric's chosen tile does; a click on the level
     around them still clears it. */
  // html-safe: level names and +/- buttons are constants for numeric levels
  function _levelInnerHtml(l, modLevel, mod) {
    if (!modLevel || l !== modLevel) return PROF_LABELS[l];
    var m = normalizeScoreMod(l, mod);
    return (
      '<span class="rsg-level-name">' +
      scoreLevelText(l, m) +
      '</span><span class="rsg-mods" role="group" aria-label="Fine-tune ' +
      PROF_LABELS[l] +
      '">' +
      scoreModButtonsHtml(l, m) +
      '</span>'
    );
  }

  function syncModRow(row) {
    if (!row) return;
    var st = rowScoreState(row);
    var modLevel = st.mixed ? 0 : st.level;
    row.querySelectorAll('.rsg-level').forEach(function (el) {
      var l = Number(el.dataset.level);
      var on = modLevel > 0 && l === modLevel && el.classList.contains('active');
      el.innerHTML = _levelInnerHtml(l, on ? modLevel : 0, st.mod);
      el.classList.toggle('has-mods', on);
    });
  }

  function syncModRows(selector) {
    document.querySelectorAll(selector).forEach(syncModRow);
  }

  function setScoreMod(el, mod) {
    var row = el.closest('.rsg-criterion-row');
    if (!row) return;
    var st = rowScoreState(row);
    if (!st.level) return;
    var next = st.mod === mod ? 0 : mod;
    if (normalizeScoreMod(st.level, next) !== next) return;
    st.tagIds.forEach(function (tid) {
      Grader.setPlusMinus(pageState.activeCourse, row.dataset.student, row.dataset.assess, tid, st.level, next);
    });
    if (row.dataset.tag) _syncTagRows(row.dataset.assess, row.dataset.student);
    else syncModRow(row);
    refreshSidebarGrades(row.dataset.student);
  }

  function selectTagLevel(el, value, aid, sid, tagId) {
    // A mixed level is the lowest of disagreeing criteria: a click sets
    // them all to it rather than clearing.
    var wasActive = el.classList.contains('active') && !el.classList.contains('mixed');
    var next = wasActive ? 0 : value;
    var before = wasActive ? structuredClone(getScores(pageState.activeCourse)) : null;
    _setTagScore(pageState.activeCourse, sid, aid, tagId, next);
    _syncTagRows(aid, sid);
    refreshSidebarGrades(sid);
    if (before) _offerClearUndo(pageState.activeCourse, before);
  }

  /* A click on the chosen level clears it. A misclick is put right from the
     toast (or Cmd+Z while it is up): Undo puts back the level and its + or
     −, unless it was scored again since (Nov 3 sweep). The phone clears
     with no toast (Nov 5). */
  function _offerClearUndo(cid, before) {
    var after = structuredClone(getScores(cid));
    _showFillUndo('Score cleared', function () {
      Grader.undo(cid, before, after);
      render();
      refreshSidebarGrades();
    });
  }

  // A criterion can feed several competencies, so a level set on one
  // competency's row can change the student's other rows: redraw them all.
  function _syncTagRows(aid, sid) {
    var selector = '.rsg-criterion-row.is-tag[data-assess="' + aid + '"][data-student="' + sid + '"]';
    document.querySelectorAll(selector).forEach(function (row) {
      var st = _tagState(pageState.activeCourse, sid, aid, row.dataset.tag);
      updateRubricRowUI(row, st.level);
      var active = st.mixed && row.querySelector('.rsg-level.active');
      if (active) active.classList.add('mixed');
      syncModRow(row);
    });
  }

  /* ── Bulk scoring ───────────────────────────────────────── */
  function closeMenus() {
    document.querySelectorAll('.col-fill-menu').forEach(function (m) {
      m.classList.remove('open');
    });
  }
  /* The menu opens under its own row. Near the foot of the window it used
     to open upward over the row above, so one student's menu (with Clear)
     looked like the student's above (Nov 3 sweep): the page scrolls up to
     make room first, and only a window too short for it opens it above. */
  function positionMenu(trigger, menu) {
    menu.style.visibility = 'hidden';
    menu.classList.add('open');
    var menuH = menu.offsetHeight || 180;
    menu.classList.remove('open');
    menu.style.visibility = '';
    var rect = trigger.getBoundingClientRect();
    var short = menuH + 8 - (window.innerHeight - rect.bottom);
    if (short > 0) {
      var scroller = _scrollParent(trigger);
      if (scroller) {
        scroller.scrollTop += Math.min(short, Math.max(0, rect.top - 8));
        rect = trigger.getBoundingClientRect();
      }
    }
    var spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < menuH + 4) {
      menu.style.bottom = window.innerHeight - rect.top + 4 + 'px';
      menu.style.top = 'auto';
    } else {
      menu.style.top = rect.bottom + 4 + 'px';
      menu.style.bottom = 'auto';
    }
    var menuW = 150;
    var left = rect.left + rect.width / 2 - menuW / 2;
    if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
    if (left < 8) left = 8;
    menu.style.left = left + 'px';
  }
  function _scrollParent(el) {
    for (var p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      var oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    }
    return document.scrollingElement;
  }
  function toggleScoreMenu(trigger) {
    var menu = trigger.querySelector('.col-fill-menu');
    var wasOpen = menu.classList.contains('open');
    closeMenus();
    if (!wasOpen) {
      positionMenu(trigger, menu);
      menu.classList.add('open');
    }
  }
  /* A fill's Undo toast. While it is up, Cmd+Z (Ctrl+Z) outside a text
     field takes the same Undo (_handleKeydown). */
  pageState._fillUndoOpen = false;
  function _showFillUndo(message, undo) {
    showUndoToast(
      message,
      function () {
        pageState._fillUndoOpen = false;
        undo();
      },
      function () {
        pageState._fillUndoOpen = false;
      },
    );
    pageState._fillUndoOpen = true;
  }
  // label: the level's name, for Set Everyone To's toast (scope 'all').
  function fillScores(aid, tagId, value, scope, label) {
    var cid = pageState.activeCourse;
    var prevScores = structuredClone(getScores(cid));
    var students = getStudents(cid);
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var statuses = getAssignmentStatuses(cid);
    var selector, toastMsg;
    if (scope === 'col') {
      students.forEach(function (st) {
        if (statuses[st.id + ':' + aid]) return;
        _setTagScore(cid, st.id, aid, tagId, value);
      });
      selector = '.rsg-criterion-row.is-tag[data-assess="' + aid + '"][data-tag="' + tagId + '"]';
      toastMsg = value ? 'Column filled' : 'Column cleared';
    } else if (scope === 'row') {
      if (!assess) return;
      var sid = tagId;
      if (!statuses[sid + ':' + aid])
        scoreTagIds(assess, cid).forEach(function (tid) {
          Grader.setLevel(cid, sid, aid, tid, value);
        });
      selector = '.rsg-criterion-row.is-tag[data-assess="' + aid + '"][data-student="' + sid + '"]';
      toastMsg = value ? 'Row filled' : 'Row cleared';
    } else {
      if (!assess) return;
      var plan = _setEveryonePlan(cid, aid);
      plan.cells.forEach(function (cell) {
        cell.keys.forEach(function (tid) {
          Grader.setLevel(cid, cell.sid, aid, tid, value);
        });
      });
      selector = '.rsg-criterion-row.is-tag[data-assess="' + aid + '"]';
      toastMsg = _setEveryoneCount(plan, plan.cells.length) + ' set to ' + label;
    }
    // Each filled row shows its new level at once, drawn from the saved
    // scores, so a student with a status (skipped) keeps what it had.
    document.querySelectorAll(selector).forEach(function (row) {
      var st = rowScoreState(row);
      updateRubricRowUI(row, st.mixed ? 0 : st.level);
    });
    syncModRows('.rsg-criterion-row[data-assess="' + aid + '"]');
    students.forEach(function (st) {
      _syncTagRows(aid, st.id);
    });
    refreshSidebarGrades();
    var filled = structuredClone(getScores(cid));
    _showFillUndo(toastMsg, function () {
      Grader.undo(cid, prevScores, filled);
      render();
      refreshSidebarGrades();
    });
  }

  /* ── Six-Point rubrics (shared/rubric-scale.js) ──────────────
     A Six-Point criterion is scored 6 to 1 and stored as the level and ±
     the score counts as, so these read and write through the score's
     stored pair. No ± of its own: the six scores are the grain. */
  /* The assessment's rubric when it has level columns of its own
     (shared/rubric-scale.js), else null. */
  function _sixRubricOf(cid, aid) {
    if (!window.RubricScale) return null;
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var rubric = assess && assess.rubricId ? getRubricById(cid, assess.rubricId) : null;
    return RubricScale.has(rubric) ? rubric : null;
  }
  // The criterion's six-point score for one student, 0 for none.
  function _sixScoreNow(cid, sid, aid, crit) {
    var state = _criterionState(cid, sid, aid, crit);
    var rubric = _sixRubricOf(cid, aid);
    return state.level && rubric ? RubricScale.fromStored(rubric, state.level, state.mod) : 0;
  }
  // Writes a six-point score (0 clears) under every key the criterion uses.
  function _writeSixScore(cid, sid, aid, crit, key) {
    var stored = key ? RubricScale.toStored(_sixRubricOf(cid, aid), key) : null;
    rubricCriterionScoreKeys(crit).forEach(function (tid) {
      Grader.setLevel(cid, sid, aid, tid, stored ? stored.level : 0, stored ? stored.mod : 0);
    });
  }
  /* What the ticks say on a Six-Point criterion, in its scores' words. */
  function _sixChecklistAdvice(rubric, crit, ticked, current) {
    var suggested = RubricChecks.suggestedLevel(crit, ticked);
    return {
      suggested: suggested,
      tone: RubricScale.tone(rubric, suggested),
      head: suggested ? 'Suggested: ' + RubricScale.label(rubric, suggested) : 'No Level Suggested Yet',
      hint: !suggested
        ? 'Tick what you saw. A level is suggested when all of its boxes are ticked.'
        : current && current !== suggested
          ? 'You picked ' + RubricScale.label(rubric, current) + '. Ticks keep your choice until you clear the level.'
          : '',
    };
  }
  // html-safe: check labels through esc; ids are ours; scores are numbers
  function _sixChecklistColsHtml(cid, rubric, crit, ticked, current, inputAttrs) {
    return RubricScale.keys(rubric, levelOrderFor(cid))
      .map(function (k) {
        return (
          '<div class="rsg-checklist-col l' +
          RubricScale.tone(rubric, k) +
          (current === k ? ' is-chosen' : '') +
          '" data-level="' +
          k +
          '" data-level-name="' +
          esc(RubricScale.label(rubric, k)) +
          '">' +
          RubricChecks.checksAt(crit, k)
            .map(function (check) {
              return (
                '<label class="rsg-check grdt-check"><input type="checkbox" ' +
                inputAttrs +
                ' data-critid="' +
                crit.id +
                '" data-checkid="' +
                check.id +
                '"' +
                (ticked.indexOf(check.id) >= 0 ? ' checked' : '') +
                '><span>' +
                esc(check.label) +
                '</span></label>'
              );
            })
            .join('') +
          '</div>'
        );
      })
      .join('');
  }
  // The six score buttons. `attrs(k)` gives each its action.
  // html-safe: score names are fixed words; attrs are ids and numbers
  function _sixButtonsHtml(cid, rubric, crit, current, cls, attrs) {
    return RubricScale.keys(rubric, levelOrderFor(cid))
      .map(function (k) {
        var on = current === k;
        var stored = RubricScale.toStored(rubric, k);
        var words = (crit.levels && (crit.levels[k] || crit.levels[String(k)])) || '';
        return (
          '<button type="button" class="' +
          cls +
          ' sp6-btn l' +
          RubricScale.tone(rubric, k) +
          (on ? ' is-on active' : '') +
          '" data-six="' +
          k +
          '" ' +
          attrs(k) +
          ' aria-pressed="' +
          on +
          '" title="' +
          esc(
            RubricScale.label(rubric, k) +
              ' (counts as ' +
              scoreLevelText(stored.level, stored.mod) +
              ')' +
              (words ? ': ' + words : ''),
          ) +
          '"><span class="sp6-num">' +
          k +
          '</span><span class="sp6-word">' +
          esc(RubricScale.name(rubric, k)) +
          '</span></button>'
        );
      })
      .join('');
  }

  /* One Six-Point criterion for one student in the whole-class grid. */
  // html-safe: names, labels and comments through esc; ids are ours
  function _sixCriterionRowHtml(cid, aid, sid, crit) {
    var rubric = _sixRubricOf(cid, aid);
    var current = _sixScoreNow(cid, sid, aid, crit);
    var hasChecks = _isAdvancedRubric(rubric) && RubricChecks.hasChecks(crit);
    var open = hasChecks && _isChecklistOpen(aid, sid, crit.id);
    var ticked = hasChecks ? getRubricCheckIds(cid, sid, aid) : [];
    var advice = open ? _sixChecklistAdvice(rubric, crit, ticked, current) : null;
    var commentBtn = CritComment.buttonHtml(aid, sid, crit);
    var note = getRubricCriterionComment(cid, sid, aid, crit);
    return (
      '<div class="rsg-criterion-row is-six' +
      (open ? ' has-checklist' : '') +
      '" data-student="' +
      sid +
      '" data-assess="' +
      aid +
      '" data-criterion="' +
      crit.id +
      '">' +
      '<div class="rsg-criterion-side">' +
      '<div class="rsg-criterion-label" data-chip-tip-name="' +
      esc(crit.name) +
      '"><span class="rsg-criterion-name">' +
      esc(crit.name) +
      '</span></div>' +
      '<div class="rsg-crit-tools">' +
      (hasChecks ? '<div class="rsg-checks-cell">' + _checksButtonHtml(cid, aid, sid, crit) + '</div>' : '') +
      commentBtn +
      '</div>' +
      (advice
        ? '<div class="rsg-checklist-advice' +
          (advice.suggested ? ' l' + advice.tone : '') +
          '"><span class="rsg-checklist-head">' +
          esc(advice.head) +
          '</span>' +
          (advice.hint ? '<span class="rsg-checklist-hint">' + esc(advice.hint) + '</span>' : '') +
          '</div>'
        : '') +
      '</div>' +
      '<div class="rsg-criterion-main">' +
      '<div class="rsg-levels sp6-levels" role="group" aria-label="Score">' +
      _sixButtonsHtml(cid, rubric, crit, current, 'rsg-level', function (k) {
        return (
          'data-action="selectSixScore" data-aid="' + aid + '" data-sid="' + sid + '" data-critid="' + crit.id + '"'
        );
      }) +
      '</div>' +
      CritComment.noteHtml(cid, aid, sid, crit, note) +
      (open
        ? '<div class="rsg-checklist" data-aid="' +
          aid +
          '" data-sid="' +
          sid +
          '" data-critid="' +
          crit.id +
          '">' +
          _sixChecklistColsHtml(
            cid,
            rubric,
            crit,
            ticked,
            current,
            'data-action="tickRubricCheck" data-aid="' + aid + '" data-sid="' + sid + '"',
          ) +
          '</div>'
        : '') +
      '</div></div>'
    );
  }
  /* Picking a score sets it; picking the chosen one again clears it. */
  function selectSixScore(aid, sid, critId, key) {
    var cid = pageState.activeCourse;
    var crit = getRubricCriterion(aid, critId);
    if (!crit || !RubricScale.isKey(_sixRubricOf(cid, aid), key)) return;
    var current = _sixScoreNow(cid, sid, aid, crit);
    var next = current === key ? 0 : key;
    if (next && isScoreLocked(cid, sid, aid)) return;
    var before = next ? null : structuredClone(getScores(cid));
    _writeSixScore(cid, sid, aid, crit, next);
    refreshSidebarGrades(sid);
    _refreshChecklistRow(aid, sid, critId, false);
    if (before) _offerClearUndo(cid, before);
  }

  /* ── Rubric Grading ─────────────────────────────────────── */
  function getRubricCriterion(aid, critId) {
    var assess = getAssessments(pageState.activeCourse).find(function (a) {
      return a.id === aid;
    });
    if (!assess || !assess.rubricId) return null;
    var rubric = getRubricById(pageState.activeCourse, assess.rubricId);
    if (!rubric) return null;
    return rubric.criteria.find(function (c) {
      return c.id === critId;
    });
  }
  function selectRubricScore(el, value, aid, sid, critId) {
    var crit = getRubricCriterion(aid, critId);
    if (!crit) return;
    var wasActive = el.classList.contains('active');
    var next = wasActive ? 0 : value;
    // Missing and Excused work takes no level (isScoreLocked); 1–4 reach here by key.
    if (next && isScoreLocked(pageState.activeCourse, sid, aid)) return;
    var before = wasActive ? structuredClone(getScores(pageState.activeCourse)) : null;
    rubricCriterionScoreKeys(crit).forEach(function (tagId) {
      Grader.setLevel(pageState.activeCourse, sid, aid, tagId, next);
    });
    el.parentElement.querySelectorAll('.rsg-level').forEach(function (o) {
      o.classList.remove('active', 'mixed');
    });
    if (!wasActive) el.classList.add('active');
    syncModRow(el.closest('.rsg-criterion-row'));
    refreshSidebarGrades(sid);
    // An open checklist's hint says whether the level is the boxes' or picked.
    if (RubricChecks.hasChecks(crit) && _isChecklistOpen(aid, sid, critId))
      _refreshChecklistRow(aid, sid, critId, false);
    if (before) _offerClearUndo(pageState.activeCourse, before);
  }
  function updateRubricRowUI(row, value) {
    row.querySelectorAll('.rsg-level').forEach(function (l) {
      l.classList.remove('active', 'mixed');
    });
    if (value > 0) {
      // The row's − | + carry the level's class too.
      var lvl = row.querySelector('.rsg-level.l' + value);
      if (lvl) lvl.classList.add('active');
    }
  }
  function fillRubricScores(aid, critId, value, scope, label) {
    var cid = pageState.activeCourse;
    var prevScores = structuredClone(getScores(cid));
    var students = getStudents(cid);
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var statuses = getAssignmentStatuses(cid);
    var selector, toastMsg;
    if (scope === 'col') {
      var crit = getRubricCriterion(aid, critId);
      if (!crit) return;
      students.forEach(function (st) {
        if (statuses[st.id + ':' + aid]) return;
        rubricCriterionScoreKeys(crit).forEach(function (tagId) {
          Grader.setLevel(cid, st.id, aid, tagId, value);
        });
      });
      selector = '.rsg-criterion-row[data-assess="' + aid + '"][data-criterion="' + critId + '"]';
      toastMsg = value ? 'Criterion filled' : 'Criterion cleared';
    } else if (scope === 'row') {
      if (!assess || !assess.rubricId) return;
      var rubric = getRubricById(cid, assess.rubricId);
      if (!rubric) return;
      var sid = critId;
      if (!statuses[sid + ':' + aid])
        rubric.criteria.forEach(function (crit) {
          rubricCriterionScoreKeys(crit).forEach(function (tagId) {
            Grader.setLevel(cid, sid, aid, tagId, value);
          });
        });
      selector = '.rsg-criterion-row[data-assess="' + aid + '"][data-student="' + sid + '"]';
      toastMsg = value ? 'Row filled' : 'Row cleared';
    } else {
      if (!assess || !assess.rubricId) return;
      var plan = _setEveryonePlan(cid, aid);
      plan.cells.forEach(function (cell) {
        cell.keys.forEach(function (tagId) {
          Grader.setLevel(cid, cell.sid, aid, tagId, value);
        });
      });
      selector = '.rsg-criterion-row[data-assess="' + aid + '"]';
      toastMsg = _setEveryoneCount(plan, plan.cells.length) + ' set to ' + label;
    }
    // Each row shows what it now holds, drawn from the saved scores, so a
    // skipped student or a criterion already scored keeps what it had.
    document.querySelectorAll(selector).forEach(function (row) {
      var st = rowScoreState(row);
      updateRubricRowUI(row, st.mixed ? 0 : st.level);
    });
    syncModRows('.rsg-criterion-row[data-assess="' + aid + '"]');
    students.forEach(function (st) {
      _syncTagRows(aid, st.id);
    });
    refreshSidebarGrades();
    var filled = structuredClone(getScores(cid));
    _showFillUndo(toastMsg, function () {
      Grader.undo(cid, prevScores, filled);
      render();
      refreshSidebarGrades();
    });
  }
  /* Set Everyone To (Colin, 2026-11-03, DECISIONS): only cells with no
     score yet are set, a rubric criterion at a time, and students marked
     Missing or Excused are skipped. The cells to set, and the counts the
     dialog and the toast name. */
  function _setEveryonePlan(cid, aid) {
    var plan = { cells: [], students: 0, scored: 0, locked: 0, perStudent: 0, rubric: false };
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    if (!assess) return plan;
    var groups;
    if (assess.rubricId) {
      var rubric = getRubricById(cid, assess.rubricId);
      if (!rubric) return plan;
      plan.rubric = true;
      groups = (rubric.criteria || []).map(rubricCriterionScoreKeys);
    } else {
      groups = scoreTagIds(assess, cid).map(function (tid) {
        return [tid];
      });
    }
    plan.perStudent = groups.length;
    var scores = getScores(cid);
    getStudents(cid).forEach(function (st) {
      if (isScoreLocked(cid, st.id, aid)) {
        plan.locked++;
        return;
      }
      var entries = scores[st.id] || [];
      var open = 0;
      groups.forEach(function (keys) {
        var scored = keys.some(function (k) {
          return isScoreEntered(
            assess,
            entries.find(function (e) {
              return e.assessmentId === aid && e.tagId === k;
            }),
          );
        });
        if (scored) plan.scored++;
        else {
          plan.cells.push({ sid: st.id, keys: keys });
          open++;
        }
      });
      if (open) plan.students++;
    });
    return plan;
  }
  // "5 students" when each student has one score to set, else "13 criteria"
  // or "13 competencies".
  function _setEveryoneCount(plan, n) {
    var words =
      plan.perStudent === 1
        ? ['student', 'students']
        : plan.rubric
          ? ['criterion', 'criteria']
          : ['competency', 'competencies'];
    return n + ' ' + words[n === 1 ? 0 : 1];
  }
  function _confirmSetEveryone(aid, value, label, fill) {
    var plan = _setEveryonePlan(pageState.activeCourse, aid);
    var n = plan.cells.length;
    var title = 'Set Everyone To ' + label;
    var skipped = plan.locked
      ? ' ' +
        (plan.locked === 1 ? '1 student is' : plan.locked + ' students are') +
        ' marked Missing or Excused and left out.'
      : '';
    if (!n) {
      showConfirm(
        title,
        'Every student already has a score or is marked Missing or Excused.',
        'OK',
        'primary',
        function () {},
      );
      return;
    }
    var what = _setEveryoneCount(plan, n);
    var message =
      plan.perStudent === 1
        ? 'Set ' + what + ' with no score yet to ' + label + '? Students already scored stay as they are.'
        : 'Set ' +
          what +
          ' with no score yet, for ' +
          (plan.students === 1 ? '1 student' : plan.students + ' students') +
          ', to ' +
          label +
          '? ' +
          (plan.rubric ? 'Criteria' : 'Competencies') +
          ' already scored stay as they are.';
    var button =
      'Set ' +
      what.replace(/ (\w)/, function (m, c) {
        return ' ' + c.toUpperCase();
      });
    showConfirm(title, message + skipped, button, 'primary', fill);
  }
  function confirmFillAll(aid, value, label) {
    _confirmSetEveryone(aid, value, label, function () {
      fillScores(aid, null, value, 'all', label);
    });
  }
  function confirmFillRubricAll(aid, value, label) {
    _confirmSetEveryone(aid, value, label, function () {
      fillRubricScores(aid, null, value, 'all', label);
    });
  }

  /* The four levels of a scoring card, in the class's Rubric Levels order
     (levelOrderFor). The `lN` / `hlN` classes and data-level stay on the
     level itself, so the 1–4 keys and the fill actions mean the same level
     wherever the button sits. */
  function _levelButtonsHtml(cid, activeClass, attrs, modLevel, mod) {
    return levelOrderFor(cid)
      .map(function (l) {
        return (
          '<div class="rsg-level l' +
          l +
          activeClass(l) +
          (modLevel && l === modLevel ? ' has-mods' : '') +
          '" ' +
          attrs(l) +
          ' role="button" tabindex="0">' +
          _levelInnerHtml(l, modLevel, mod) +
          '</div>'
        );
      })
      .join('<span class="rsg-level-sep" aria-hidden="true"></span>');
  }
  /* A single-point rubric's Proficient standard, once above the class:
     a tinted card per criterion. */
  function _singlePointStripHtml(rubric) {
    return (
      '<div class="rsg-sp-strip"><span class="rsg-sp-strip-label"><span class="grsp-dot" aria-hidden="true"></span>Proficient Standard</span>' +
      '<div class="rsg-sp-cards">' +
      (rubric.criteria || [])
        .map(function (crit) {
          return (
            '<div class="rsg-sp-card"><span class="rsg-sp-card-name">' +
            esc(crit.name || '') +
            '</span><span class="rsg-sp-card-words">' +
            esc((crit.levels && (crit.levels[3] || crit.levels['3'])) || '') +
            '</span></div>'
          );
        })
        .join('') +
      '</div></div>'
    );
  }
  /* Work On and Went Beyond under a single-point criterion's level control:
     white fields, label above, saved when they lose focus. */
  function _rsgSinglePointNotesHtml(cid, aid, sid, crit) {
    var st = getStudents(cid).find(function (x) {
      return x.id === sid;
    });
    var name = esc((crit.name || '') + (st ? ', ' + displayNameWithLast(st) : ''));
    function field(kind, label, text) {
      return (
        '<label class="rsg-sp-field is-' +
        kind +
        '"><span class="rsg-sp-label"><span class="grsp-dot" aria-hidden="true"></span>' +
        label +
        '</span><input type="text" class="rsg-sp-input" value="' +
        esc(text) +
        '" aria-label="' +
        label +
        ', ' +
        name +
        '" data-action-blur="' +
        (kind === 'work' ? 'rsgWorkOn' : 'rsgBeyond') +
        '" data-aid="' +
        aid +
        '" data-sid="' +
        sid +
        '" data-critid="' +
        crit.id +
        '"></label>'
      );
    }
    return (
      '<div class="rsg-sp-notes">' +
      field('work', 'Work On', getRubricCriterionComment(cid, sid, aid, crit)) +
      field('beyond', 'Went Beyond', getRubricCriterionBeyond(cid, sid, aid, crit)) +
      '</div>'
    );
  }
  /* ── Group work on the page (Group grading, shared/data.js) ──
     The list grades Pair and Group work one group at a time, as the dialog
     does: a block named for the group, a strip of its members (each with
     Missing | Excused | Late and a ⋯ menu with Grade Separately), and the
     grading rows of the member the group's grade is copied from. A member
     graded separately follows their group as their own block, with Graded
     Separately From and Back to Group Grade. DIBELS stays per student. */
  var _groupRows = {};
  // Set while the rubric view draws its Additional Tags rows.
  pageState._groupStripOff = false;

  // The students the list shows for `a`: one per group (the member its
  // grade comes from), members graded separately and students in no group,
  // in the dialog's order. Only groups with someone the search shows.
  function _groupRowStudents(cid, a, students) {
    var units = _graderUnits(cid, a);
    delete _groupRows[a.id];
    if (!units) return students;
    var shown = {};
    var byId = {};
    students.forEach(function (st) {
      shown[st.id] = true;
      byId[st.id] = st;
    });
    getStudents(cid).forEach(function (st) {
      if (!byId[st.id]) byId[st.id] = st;
    });
    var rows = {};
    var list = [];
    units.forEach(function (unit) {
      if (
        !_unitIds(unit).some(function (m) {
          return shown[m];
        })
      )
        return;
      if (unit.linked) {
        rows[unit.source] = { view: Object.assign({ label: collabGroupLabel(unit.group) }, unit) };
        list.push(byId[unit.source]);
        return;
      }
      if (unit.separateFrom) rows[unit.sid] = { separateFrom: unit.separateFrom };
      list.push(byId[unit.sid]);
    });
    _groupRows[a.id] = rows;
    return list.filter(Boolean);
  }
  function _groupRowFor(aid, sid) {
    return (_groupRows[aid] && _groupRows[aid][sid]) || null;
  }

  // html-safe: names go through esc(); ids are ours; labels are constants
  function _groupMembersStripHtml(cid, aid, view) {
    var a = _assessmentById(cid, aid);
    var byId = {};
    getStudents(cid).forEach(function (st) {
      byId[st.id] = st;
    });
    return (
      '<div class="rsg-group-members" data-stop-prop="true">' +
      view.members
        .map(function (m) {
          var st = byId[m];
          var name = esc(displayNameWithLast(st));
          if (isGradedSeparately(a, m))
            return (
              '<div class="rsg-group-member is-separate"><span class="rsg-group-member-name">' +
              name +
              '</span><span class="rsg-group-member-note">Graded Separately</span></div>'
            );
          return (
            '<div class="rsg-group-member"><span class="rsg-group-member-name">' +
            name +
            '</span><div class="grader-status rsg-status" role="group" aria-label="Status for ' +
            name +
            '">' +
            _graderStatusButtons(aid, m, getAssignmentStatus(cid, m, aid), ['NS', 'EXC', 'LATE']) +
            '</div><button type="button" class="grader-member-more" data-action="groupMemberMenu" data-aid="' +
            aid +
            '" data-sid="' +
            m +
            '" aria-label="More for ' +
            name +
            '" aria-haspopup="menu" aria-expanded="false">' +
            _GRADER_MORE_ICON +
            '</button><div class="grader-member-menu" role="menu" hidden><button type="button" role="menuitem" data-action="groupGradeSeparately" data-aid="' +
            aid +
            '" data-sid="' +
            m +
            '">Grade Separately</button></div></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  // html-safe: the label goes through esc(); ids are ours
  function _groupSeparateNoteHtml(aid, sid, group) {
    return (
      '<span class="rsg-separate-note">' +
      esc('Graded Separately From ' + collabGroupLabel(group)) +
      '</span><button type="button" class="grader-member-back" data-action="groupBackToGroup" data-aid="' +
      aid +
      '" data-sid="' +
      sid +
      '">Back to Group Grade</button>'
    );
  }

  // A ledger row's status cell, or an empty cell on a group's row (its
  // members' statuses are in the strip under it).
  function _ledgerStatusOrNoteHtml(aid, sid, stStatus) {
    var row = _groupRowFor(aid, sid);
    return row && row.view ? '<div class="ldg-status"></div>' : ledgerStatusHtml(aid, sid, stStatus);
  }
  // Under a ledger row: a group's members, or a separated member's note.
  function _ledgerMembersHtml(cid, aid, sid) {
    var row = _groupRowFor(aid, sid);
    if (row && row.view) return _groupMembersStripHtml(cid, aid, row.view);
    if (row && row.separateFrom)
      return '<div class="rsg-group-members">' + _groupSeparateNoteHtml(aid, sid, row.separateFrom) + '</div>';
    return '';
  }

  // The strip's ⋯ menu: one open at a time; a click elsewhere closes it.
  function _closeGroupMenus(except) {
    document.querySelectorAll('.rsg-group-members .grader-member-menu').forEach(function (menu) {
      if (menu === except) return;
      menu.hidden = true;
      var more = menu.parentNode.querySelector('.grader-member-more');
      if (more) more.setAttribute('aria-expanded', 'false');
    });
  }
  function _toggleGroupMenu(btn) {
    var menu = btn.parentNode.querySelector('.grader-member-menu');
    if (!menu) return;
    _closeGroupMenus(menu);
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) menu.querySelector('button').focus();
  }

  /* The small Printed / Changed Since Printed marker beside a name, once the
     student's completed rubric has been printed (teacher/rubric-print.js). */
  function _printMarkHtml(cid, aid, sid) {
    return window.RubricPrint && RubricPrint.markHtml ? RubricPrint.markHtml(cid, aid, sid) : '';
  }
  // A level, comment or status may have changed what the sheet would show.
  function _refreshPrintMarks() {
    if (window.RubricPrint && RubricPrint.refreshMarks && pageState.activeCourse)
      RubricPrint.refreshMarks(pageState.activeCourse);
  }
  function _queuePrintMarks() {
    setTimeout(_refreshPrintMarks, 0);
  }

  /* A student's row in the whole-class grid: the name, Missing | Excused |
     Late, and the row's fill menu. */
  function _rsgStudentHeadHtml(cid, aid, st, status, fillAction) {
    var row = _groupRowFor(aid, st.id);
    return (
      '<div class="rsg-student-head">' +
      '<span class="rsg-student-name">' +
      esc(row && row.view ? row.view.label : displayNameWithLast(st)) +
      '</span>' +
      (row && row.view ? '' : _printMarkHtml(cid, aid, st.id)) +
      // Draft or Returned (S1-F2). A rubric's second grid, Competencies Not
      // in the Rubric, repeats the head: the mark is drawn once, above.
      (pageState._groupStripOff ? '' : _returnMarkHtml(cid, aid, st.id)) +
      (row && row.view
        ? ''
        : '<div class="grader-status rsg-status" role="group" aria-label="Status" data-stop-prop="true">' +
          _graderStatusButtons(aid, st.id, status, ['NS', 'EXC', 'LATE']) +
          '</div>' +
          (row && row.separateFrom ? _groupSeparateNoteHtml(aid, st.id, row.separateFrom) : '')) +
      (row && row.view ? '' : _workIconHtml(cid, aid, st)) +
      '<div class="score-row-action"><div class="row-fill-btn" data-action="toggleScoreMenu" title="Set this student\'s levels" aria-label="Set this student\'s levels">' +
      _ROW_FILL_ICON +
      '<div class="col-fill-menu" data-stop-prop="true">' +
      _rowFillOptionsHtml(cid, fillAction, aid, st.id) +
      '<div class="col-fill-option" data-action="' +
      fillAction +
      '" data-aid="' +
      aid +
      '" data-sid="' +
      st.id +
      '" data-score="0" data-scope="row"><div class="col-fill-dot" style="background:var(--surface-2);color:var(--text-3)">0</div> Clear</div>' +
      '</div></div></div>' +
      '</div>' +
      (row && row.view && !pageState._groupStripOff ? _groupMembersStripHtml(cid, aid, row.view) : '')
    );
  }
  /* The student's Overall Comment under their criteria (score.comment, the
     comment on the work; it prints on the rubric handout). One line until
     clicked, three while it holds text; it saves as the teacher types and
     when they leave it, level or not. */
  function _overallCommentFieldHtml(cid, aid, st, cls) {
    var row = _groupRowFor(aid, st.id);
    var first = row && row.view ? row.view.label : displayNameFirst(st);
    var text = getScoreComment(cid, st.id, aid);
    return (
      '<textarea class="' +
      cls +
      (text ? ' has-text' : '') +
      '" rows="1" placeholder="Add an overall comment' +
      (first ? ' for ' + esc(first) : '') +
      '" aria-label="Overall comment, ' +
      esc(displayNameWithLast(st)) +
      '" data-action-blur="rsgOverallComment" data-action-input="rsgOverallComment" data-aid="' +
      aid +
      '" data-sid="' +
      st.id +
      '">' +
      esc(text) +
      '</textarea>'
    );
  }
  function _rsgOverallCommentHtml(cid, aid, st) {
    return '<div class="rsg-overall">' + _overallCommentFieldHtml(cid, aid, st, 'rsg-overall-comment') + '</div>';
  }
  /* The one-student views' Overall Comment: a row under the tiles, cards
     or single-point rows, the same field and saving as the grid's. */
  function _graderOverallCommentHtml(cid, a, st) {
    var text = getScoreComment(cid, st.id, a.id);
    return (
      '<div class="grdt-tiles grdt-overall"><section class="grdt-crit" aria-label="Overall Comment">' +
      '<div class="grdt-note-row"><label class="grdt-note-label" for="grdt-overall-' +
      a.id +
      '">Overall Comment</label>' +
      '<textarea id="grdt-overall-' +
      a.id +
      '" class="grdt-note' +
      (text ? ' has-text' : '') +
      '" rows="1" placeholder="Add an overall comment for ' +
      esc(displayNameFirst(st)) +
      '" data-action-blur="rsgOverallComment" data-action-input="rsgOverallComment" data-aid="' +
      a.id +
      '" data-sid="' +
      st.id +
      '">' +
      esc(text) +
      '</textarea></div></section></div>'
    );
  }
  var _overallCommentTimers = {};
  function _saveOverallComment(el) {
    var key = el.dataset.sid + ':' + el.dataset.aid;
    clearTimeout(_overallCommentTimers[key]);
    delete _overallCommentTimers[key];
    var text = el.value.trim();
    el.classList.toggle('has-text', !!text);
    if (text === getScoreComment(pageState.activeCourse, el.dataset.sid, el.dataset.aid)) return;
    Grader.setOverallComment(pageState.activeCourse, el.dataset.sid, el.dataset.aid, text);
    // A comment saved off its timer follows no click: the status locks and
    // the Draft marks do (the locks followed the next key typed).
    var scope = _gradingScope(el.dataset.aid, el.dataset.sid);
    _syncStatusLocks(scope);
    _returnsAfterEvent(scope);
  }
  function _queueOverallComment(el) {
    el.classList.toggle('has-text', !!el.value.trim());
    var key = el.dataset.sid + ':' + el.dataset.aid;
    clearTimeout(_overallCommentTimers[key]);
    _overallCommentTimers[key] = setTimeout(function () {
      _saveOverallComment(el);
    }, 800);
  }
  var _ROW_FILL_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  function _rowFillOptionsHtml(cid, action, aid, sid) {
    return levelOrderFor(cid)
      .map(function (l) {
        return (
          '<div class="col-fill-option" data-action="' +
          action +
          '" data-aid="' +
          aid +
          '" data-sid="' +
          sid +
          '" data-score="' +
          l +
          '" data-scope="row"><div class="col-fill-dot" style="background:var(--score-' +
          l +
          ')">' +
          l +
          '</div> ' +
          PROF_LABELS[l] +
          '</div>'
        );
      })
      .join('');
  }

  function renderTagGrid(cid, a, tagObjs, students, scores) {
    var html = '<div class="rsg-grid">';
    var statuses = getAssignmentStatuses(cid);
    students.forEach(function (st) {
      var stStatus = statuses[st.id + ':' + a.id] || null;
      var disableRow = stStatus && stStatus !== 'LATE';
      html +=
        '<div class="rsg-student' +
        (disableRow ? ' has-status' : '') +
        (stStatus === 'LATE' ? ' has-late' : '') +
        '" data-status-student="' +
        st.id +
        '" data-status-assess="' +
        a.id +
        '">' +
        _rsgStudentHeadHtml(cid, a.id, st, stStatus, 'fillScoresAndClose') +
        '<div class="rsg-criteria">';
      tagObjs.forEach(function (tag) {
        var state = _tagState(cid, st.id, a.id, tag.id);
        var score = state.level;
        var mod = normalizeScoreMod(score, state.mod);
        html +=
          '<div class="rsg-criterion-row is-tag" data-student="' +
          st.id +
          '" data-assess="' +
          a.id +
          '" data-tag="' +
          tag.id +
          '">' +
          '<div class="rsg-criterion-side">' +
          '<div class="rsg-criterion-label" data-chip-tip-name="' +
          esc(tag.label) +
          (tag.text && tag.text !== tag.label ? '" data-name-tip-text="' + esc(tag.text) : '') +
          '"><svg class="rsg-tag-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 9.5V2.5a1 1 0 0 1 1-1h7l5 5v3"/><path d="M14.5 9.5l-5 5-4-4 5-5"/><circle cx="5" cy="5" r="1" fill="currentColor" stroke="none"/></svg>' +
          '<span class="rsg-criterion-name">' +
          esc(tag.label) +
          '</span></div></div>' +
          '<div class="rsg-levels">' +
          _levelButtonsHtml(
            cid,
            function (l) {
              return score === l ? (state.mixed ? ' active mixed' : ' active') : '';
            },
            function (l) {
              return (
                'data-action="selectTagLevel" data-level="' +
                l +
                '" data-aid="' +
                a.id +
                '" data-sid="' +
                st.id +
                '" data-tagid="' +
                tag.id +
                '"'
              );
            },
            state.mixed ? 0 : score,
            mod,
          ) +
          '</div></div>';
      });
      html += '</div>' + _rsgOverallCommentHtml(cid, a.id, st) + '</div>';
    });
    html += '</div>';
    return html;
  }

  /* ── Advanced Rubric checklists (plan §5, PR 8; mockup C10) ──
     A criterion row gets a Checks button ("3/8"); it opens the criterion's
     checkboxes under the row, one column under each level button. Ticking
     a box saves the tick and writes the level the boxes suggest, unless the
     teacher picked a different level by hand (RubricChecks.levelAfterTick). */
  function _isAdvancedRubric(rubric) {
    return (
      !!rubric &&
      typeof rubricStyle === 'function' &&
      rubricStyle(rubric) === 'advanced' &&
      (rubric.criteria || []).some(function (c) {
        return RubricChecks.hasChecks(c);
      })
    );
  }
  function _checklistMode() {
    try {
      return localStorage.getItem(CHECKLIST_MODE_KEY) === 'hide' ? 'hide' : 'show';
    } catch (e) {
      return 'show';
    }
  }
  function _checklistKey(aid, sid, critId) {
    return aid + ':' + sid + ':' + critId;
  }
  function _isChecklistOpen(aid, sid, critId) {
    var key = _checklistKey(aid, sid, critId);
    return _checklistMode() === 'show' ? !_closedChecklists.has(key) : _openChecklists.has(key);
  }
  function _checksButtonHtml(cid, aid, sid, crit) {
    if (!RubricChecks.hasChecks(crit)) return '';
    var count = RubricChecks.tickedCount(crit, getRubricCheckIds(cid, sid, aid));
    var open = _isChecklistOpen(aid, sid, crit.id);
    return (
      '<button type="button" class="rsg-checks-btn' +
      (open ? ' is-open' : '') +
      (count.ticked ? ' has-ticks' : '') +
      '" data-action="toggleChecklist" data-aid="' +
      aid +
      '" data-sid="' +
      sid +
      '" data-critid="' +
      crit.id +
      '" aria-expanded="' +
      open +
      '" aria-label="Checklist for ' +
      esc(crit.name) +
      ', ' +
      count.ticked +
      ' ticked" title="Checklist (K)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12l3 3 5-6"/></svg>' +
      // Only the ticks: teachers tick what the student showed at the level
      // they reached, never every box, so a total reads as work left undone.
      (count.ticked ? count.ticked : 'Checklist') +
      '</button>'
    );
  }
  /* The checkboxes under a criterion row, in the class's level order, with
     the level they suggest at the left. */
  /* What the ticked boxes say about a criterion's level, in the words the
     checklist and the grader both show. */
  function _checklistAdvice(crit, ticked, currentLevel) {
    var suggested = RubricChecks.suggestedLevel(crit, ticked);
    var current = Number(currentLevel) || 0;
    return {
      suggested: suggested,
      head: suggested ? 'Suggested: ' + PROF_LABELS[suggested] : 'No Level Suggested Yet',
      hint: !suggested
        ? 'Tick what you saw. A level is suggested when all of its boxes are ticked.'
        : current && current !== suggested
          ? 'You picked ' + PROF_LABELS[current] + '. Ticks keep your choice until you clear the level.'
          : // The level already matches the ticks: nothing to explain.
            '',
    };
  }
  function _checklistPanelHtml(cid, aid, sid, crit, currentLevel) {
    var ticked = getRubricCheckIds(cid, sid, aid);
    var html =
      '<div class="rsg-checklist" data-aid="' + aid + '" data-sid="' + sid + '" data-critid="' + crit.id + '">';
    levelOrderFor(cid).forEach(function (lv) {
      html +=
        '<div class="rsg-checklist-col l' +
        lv +
        (Number(currentLevel) === lv ? ' is-chosen' : '') +
        '" data-level="' +
        lv +
        '">';
      RubricChecks.checksAt(crit, lv).forEach(function (check) {
        html +=
          '<label class="rsg-check"><input type="checkbox" data-action="tickRubricCheck" data-aid="' +
          aid +
          '" data-sid="' +
          sid +
          '" data-critid="' +
          crit.id +
          '" data-checkid="' +
          check.id +
          '"' +
          (ticked.indexOf(check.id) >= 0 ? ' checked' : '') +
          '><span>' +
          esc(check.label) +
          '</span></label>';
      });
      html += '</div>';
    });
    return html + '</div>';
  }
  /* The level a criterion row shows now: the grid's rule (lowest when its
     competencies disagree). */
  function _criterionLevelNow(cid, aid, sid, crit) {
    return RubricPrint.criterionLevel(getScores(cid)[sid] || [], aid, crit).level;
  }
  function _criterionRow(aid, sid, critId) {
    return document.querySelector(
      '.rsg-criterion-row[data-assess="' + aid + '"][data-student="' + sid + '"][data-criterion="' + critId + '"]',
    );
  }
  function toggleChecklist(el) {
    var aid = el.dataset.aid,
      sid = el.dataset.sid,
      critId = el.dataset.critid;
    var key = _checklistKey(aid, sid, critId);
    var open = _isChecklistOpen(aid, sid, critId);
    var set = _checklistMode() === 'show' ? _closedChecklists : _openChecklists;
    if (open === (set === _closedChecklists)) set.add(key);
    else set.delete(key);
    _refreshChecklistRow(aid, sid, critId, true);
  }
  function setChecklistMode(mode) {
    try {
      localStorage.setItem(CHECKLIST_MODE_KEY, mode === 'hide' ? 'hide' : 'show');
    } catch (e) {
      /* storage blocked: Show */
    }
    _openChecklists.clear();
    _closedChecklists.clear();
    render();
  }
  /* Redraw one criterion row after its checklist opens, closes or ticks,
     keeping keyboard focus on it. */
  function _refreshChecklistRow(aid, sid, critId, focusButton) {
    var cid = pageState.activeCourse;
    var crit = getRubricCriterion(aid, critId);
    var row = _criterionRow(aid, sid, critId);
    if (!crit || !row) return;
    var hadKb = pageState._kbFocusEl === row;
    row.outerHTML = _rubricCriterionRowHtml(cid, aid, sid, crit, getScores(cid)[sid] || [], true);
    var fresh = _criterionRow(aid, sid, critId);
    if (hadKb && fresh) kbFocusCell(fresh);
    if (focusButton && fresh) {
      var btn = fresh.querySelector('.rsg-checks-btn');
      if (btn) btn.focus();
    }
  }
  function tickRubricCheck(el) {
    var cid = pageState.activeCourse;
    var aid = el.dataset.aid,
      sid = el.dataset.sid,
      critId = el.dataset.critid,
      checkId = el.dataset.checkid;
    var crit = getRubricCriterion(aid, critId);
    if (!crit) return;
    // Missing and Excused work takes no score (isScoreLocked): the box goes back.
    if (el.checked && isScoreLocked(cid, sid, aid)) {
      el.checked = false;
      return;
    }
    var before = getRubricCheckIds(cid, sid, aid);
    var after = Grader.setTick(cid, sid, aid, checkId, el.checked);
    if (_sixRubricOf(cid, aid)) {
      var nowSix = _sixScoreNow(cid, sid, aid, crit);
      var nextSix = RubricChecks.levelAfterTick(crit, nowSix, before, after);
      if (nextSix !== nowSix) {
        _writeSixScore(cid, sid, aid, crit, nextSix);
        refreshSidebarGrades(sid);
      }
      _refreshChecklistRow(aid, sid, critId, false);
      var box = document.querySelector(
        '.rsg-checklist input[data-sid="' + sid + '"][data-aid="' + aid + '"][data-checkid="' + checkId + '"]',
      );
      if (box) box.focus();
      return;
    }
    var current = _criterionLevelNow(cid, aid, sid, crit);
    var next = RubricChecks.levelAfterTick(crit, current, before, after);
    if (next !== current) {
      rubricCriterionScoreKeys(crit).forEach(function (tagId) {
        Grader.setLevel(cid, sid, aid, tagId, next);
      });
      var row = _criterionRow(aid, sid, critId);
      if (row) {
        updateRubricRowUI(row, next);
        syncModRow(row);
      }
      refreshSidebarGrades(sid);
    }
    _refreshChecklistRow(aid, sid, critId, false);
    var again = document.querySelector(
      '.rsg-checklist input[data-sid="' + sid + '"][data-aid="' + aid + '"][data-checkid="' + checkId + '"]',
    );
    if (again) again.focus();
  }

  function renderRubricGradingView(cid, a, students, scores) {
    var rubric = getRubricById(cid, a.rubricId);
    if (!rubric) return '';
    var criteria = rubric.criteria || [];
    var rubricTagIds = new Set(rubricScoredTagIds(rubric));
    var extraTagIds = (a.tagIds || []).filter(function (tid) {
      return !rubricTagIds.has(tid);
    });
    var extraTagObjs = extraTagIds
      .map(function (tid) {
        return getTagById(cid, tid);
      })
      .filter(Boolean);

    var advanced = _isAdvancedRubric(rubric);
    var single = rubricStyle(rubric) === 'single_point';
    var html = '<div class="rsg-grid' + (advanced ? ' is-advanced' : '') + (single ? ' is-single-point' : '') + '">';
    if (single) html += _singlePointStripHtml(rubric);

    var statuses = getAssignmentStatuses(cid);
    students.forEach(function (st) {
      var studentScores = scores[st.id] || [];
      var stStatus = statuses[st.id + ':' + a.id] || null;
      var disableRow = stStatus && stStatus !== 'LATE';
      html +=
        '<div class="rsg-student' +
        (disableRow ? ' has-status' : '') +
        (stStatus === 'LATE' ? ' has-late' : '') +
        '" data-status-student="' +
        st.id +
        '" data-status-assess="' +
        a.id +
        '">' +
        _rsgStudentHeadHtml(cid, a.id, st, stStatus, 'fillRubricScoresAndClose') +
        '<div class="rsg-criteria">';
      criteria.forEach(function (crit) {
        html += _rubricCriterionRowHtml(cid, a.id, st.id, crit, studentScores, advanced, single);
      });
      html += '</div>' + _rsgOverallCommentHtml(cid, a.id, st) + '</div>';
    });
    html += '</div>';

    if (extraTagObjs.length > 0) {
      html +=
        '<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">' +
        '<div style="font-size:0.75rem;color:var(--text-3);font-weight:600;margin-bottom:6px">Competencies Not in the Rubric</div>';
      // The group's name and members strip are drawn once, above.
      pageState._groupStripOff = true;
      try {
        html += renderTagGrid(cid, a, extraTagObjs, students, scores);
      } finally {
        pageState._groupStripOff = false;
      }
      html += '</div>';
    }
    return html;
  }

  /* One criterion for one student in the whole-class grid. On an Advanced
     rubric with its checklist open, the suggestion sits under the tools and
     a column of boxes under each level button, inside the row. */
  // html-safe: criterion names, check labels and comments through esc; levels are numbers; ids are ours
  function _rubricCriterionRowHtml(cid, aid, sid, crit, studentScores, advanced, single) {
    if (_sixRubricOf(cid, aid)) return _sixCriterionRowHtml(cid, aid, sid, crit);
    var tagMods = [];
    var tagScores = rubricCriterionScoreKeys(crit).map(function (tid) {
      var entry = studentScores.find(function (s) {
        return s.assessmentId === aid && s.tagId === tid;
      });
      if (entry && entry.score > 0) tagMods.push(normalizeScoreMod(entry.score, entry.mod));
      return entry ? entry.score : 0;
    });
    var nonZero = tagScores.filter(function (s) {
      return s > 0;
    });
    var allSame =
      nonZero.length > 0 &&
      nonZero.every(function (s) {
        return s === nonZero[0];
      });
    var displayScore = nonZero.length === 0 ? 0 : allSame ? nonZero[0] : Math.min.apply(null, nonZero);
    var isMixed = nonZero.length > 0 && !allSame;
    var critMod =
      !isMixed &&
      tagMods.every(function (m) {
        return m === tagMods[0];
      })
        ? tagMods[0] || 0
        : 0;
    var modLevel =
      isMixed ||
      tagMods.some(function (m) {
        return m !== tagMods[0];
      })
        ? 0
        : displayScore;
    var open = advanced && RubricChecks.hasChecks(crit) && _isChecklistOpen(aid, sid, crit.id);
    var advice = open ? _checklistAdvice(crit, getRubricCheckIds(cid, sid, aid), displayScore) : null;
    // A single-point criterion's comment is its Work On field.
    var commentBtn = single ? '' : CritComment.buttonHtml(aid, sid, crit);
    var note = single ? '' : getRubricCriterionComment(cid, sid, aid, crit);
    return (
      '<div class="rsg-criterion-row' +
      (open ? ' has-checklist' : '') +
      '" data-student="' +
      sid +
      '" data-assess="' +
      aid +
      '" data-criterion="' +
      crit.id +
      '">' +
      '<div class="rsg-criterion-side">' +
      '<div class="rsg-criterion-label" data-chip-tip-name="' +
      esc(crit.name) +
      '"><span class="rsg-criterion-name">' +
      esc(crit.name) +
      '</span></div>' +
      (advanced || commentBtn
        ? '<div class="rsg-crit-tools">' +
          (advanced ? '<div class="rsg-checks-cell">' + _checksButtonHtml(cid, aid, sid, crit) + '</div>' : '') +
          commentBtn +
          '</div>'
        : '') +
      (advice
        ? '<div class="rsg-checklist-advice' +
          (advice.suggested ? ' l' + advice.suggested : '') +
          '"><span class="rsg-checklist-head">' +
          esc(advice.head) +
          '</span>' +
          (advice.hint ? '<span class="rsg-checklist-hint">' + esc(advice.hint) + '</span>' : '') +
          '</div>'
        : '') +
      '</div>' +
      '<div class="rsg-criterion-main">' +
      '<div class="rsg-levels">' +
      _levelButtonsHtml(
        cid,
        function (l) {
          return displayScore === l ? (isMixed ? ' active mixed' : ' active') : '';
        },
        function (l) {
          return (
            'data-action="selectRubricScore" data-level="' +
            l +
            '" data-aid="' +
            aid +
            '" data-sid="' +
            sid +
            '" data-critid="' +
            crit.id +
            '"'
          );
        },
        modLevel,
        critMod,
      ) +
      '</div>' +
      (advanced || single ? '' : RubricWords.panelHtml(crit, levelOrderFor(cid), displayScore)) +
      CritComment.noteHtml(cid, aid, sid, crit, note) +
      (open ? _checklistPanelHtml(cid, aid, sid, crit, displayScore) : '') +
      (single ? _rsgSinglePointNotesHtml(cid, aid, sid, crit) : '') +
      '</div></div>'
    );
  }

  /* ── The rubric editor window (Nov 19) ─────────────────────
     New and Edit from the Rubric Bank open the Blank Rubric card (the
     assessment form's editor) in a large window, so a rubric is built the
     same way wherever it is built. The card's state is `_blank`, with
     host 'modal'; a Blank draft open on the form waits in _formBlank. */
  pageState._formBlank = null;
  AssignBlankRubric.configure({ _RUBRIC_STYLE_NAMES: _RUBRIC_STYLE_NAMES });

  /* ── Comment Popover ────────────────────────────────────── */
  function openCommentPopover(cid, sid, aid) {
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var student = getStudents(cid).find(function (s) {
      return s.id === sid;
    });
    if (!assess || !student) return;
    pageState._commentPopoverState = { cid: cid, sid: sid, aid: aid };
    renderCommentPopover();
  }
  /* The Comment button counts the comments left on the work and its
     overall comment (the note on its score). */
  function _assignmentCommentCount(cid, sid, aid) {
    return getAssignmentObs(cid, sid, aid).length + (getScoreComment(cid, sid, aid) ? 1 : 0);
  }
  var OVERALL_COMMENT_ID = 'overall';
  function _overallCommentHtml(cid, sid, aid) {
    var text = getScoreComment(cid, sid, aid);
    if (!text) return '';
    var pill = '<span class="comment-entry-pills"><span class="obs-pill">Overall Comment</span></span>';
    if (pageState._commentEditId === OVERALL_COMMENT_ID) {
      return (
        '<div class="comment-entry is-editing"><span class="comment-entry-date"></span><span class="comment-entry-main"><textarea class="comment-entry-input" rows="3" aria-label="Edit overall comment">' +
        esc(text) +
        '</textarea><span class="comment-entry-edit-actions"><button type="button" class="btn btn-ghost" data-action="cancelCommentEdit" data-stop-prop="true">Cancel</button><button type="button" class="btn btn-primary" data-action="saveCommentEdit" data-stop-prop="true">Save</button></span></span></div>'
      );
    }
    return (
      '<div class="comment-entry"><span class="comment-entry-date"></span><span class="comment-entry-main"><span class="comment-entry-text">' +
      esc(text) +
      '</span>' +
      pill +
      '</span><button class="comment-entry-edit" data-action="editComment" data-obid="' +
      OVERALL_COMMENT_ID +
      '" data-stop-prop="true" title="Edit" aria-label="Edit overall comment"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 2.5l3 3-8 8h-3v-3z"/></svg></button><button class="comment-entry-del" data-action="deleteComment" data-obid="' +
      OVERALL_COMMENT_ID +
      '" data-stop-prop="true" title="Delete" aria-label="Delete overall comment">✕</button></div>'
    );
  }
  // html-safe: comment text and pill labels through esc; dates are formatted Dates; ids are ours
  function _commentEntriesHtml(cid, sid, aid) {
    var obs = getAssignmentObs(cid, sid, aid);
    var overall = _overallCommentHtml(cid, sid, aid);
    if (obs.length === 0 && !overall) return '<div class="comment-popover-empty">No comments yet</div>';
    return (
      '<div class="comment-popover-entries">' +
      overall +
      obs
        .map(function (o) {
          var d = new Date(o.created);
          var ds = d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
          var sent = o.sentiment && OBS_SENTIMENTS[o.sentiment];
          var pills =
            (sent
              ? '<span class="obs-pill obs-pill-type" data-sentiment="' +
                esc(o.sentiment) +
                '">' +
                esc(sent.label) +
                '</span>'
              : '') +
            obsPrivateLabelHtml(o) +
            (o.dims || [])
              .map(function (t) {
                return '<span class="obs-pill">' + esc(resolveTag(t).label) + '</span>';
              })
              .join('') +
            ObsCapture.linkPillsHtml(cid, o);
          if (o.id === pageState._commentEditId) {
            return (
              '<div class="comment-entry is-editing"><span class="comment-entry-date">' +
              ds +
              '</span><span class="comment-entry-main"><textarea class="comment-entry-input" rows="2" aria-label="Edit comment">' +
              esc(o.text) +
              '</textarea><span class="comment-entry-edit-actions"><button type="button" class="btn btn-ghost" data-action="cancelCommentEdit" data-stop-prop="true">Cancel</button><button type="button" class="btn btn-primary" data-action="saveCommentEdit" data-stop-prop="true">Save</button></span></span></div>'
            );
          }
          return (
            '<div class="comment-entry"><span class="comment-entry-date">' +
            ds +
            '</span><span class="comment-entry-main"><span class="comment-entry-text">' +
            esc(o.text) +
            '</span>' +
            (pills ? '<span class="comment-entry-pills">' + pills + '</span>' : '') +
            '</span><button class="comment-entry-edit" data-action="editComment" data-obid="' +
            o.id +
            '" data-stop-prop="true" title="Edit" aria-label="Edit comment"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 2.5l3 3-8 8h-3v-3z"/></svg></button><button class="comment-entry-del" data-action="deleteComment" data-obid="' +
            o.id +
            '" data-stop-prop="true" title="Delete" aria-label="Delete comment">\u2715</button></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }
  /* The comment box is the shared capture strip, with the student and the
     assessment fixed. The overlay is built once per student and assessment
     so the strip keeps its state; adding or deleting redraws the list. */
  pageState._commentCapture = null;
  function renderCommentPopover() {
    if (!pageState._commentPopoverState) return;
    var cid = pageState._commentPopoverState.cid,
      sid = pageState._commentPopoverState.sid,
      aid = pageState._commentPopoverState.aid;
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var student = getStudents(cid).find(function (s) {
      return s.id === sid;
    });
    if (!assess || !student) return;
    var overlay = document.getElementById('comment-popover-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'comment-popover-overlay';
      overlay.className = 'comment-popover-overlay';
      overlay.onclick = function (e) {
        if (e.target === this) closeCommentPopover();
      };
      // A modal: keys typed in it are not scoring shortcuts. Escape closes it.
      overlay.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Escape' && !e.defaultPrevented) closeCommentPopover();
      });
      document.body.appendChild(overlay);
    }
    var key = cid + '|' + sid + '|' + aid;
    if (overlay.dataset.key !== key || !pageState._commentCapture) {
      if (pageState._commentCapture) pageState._commentCapture.destroy();
      overlay.dataset.key = key;
      overlay.innerHTML =
        '<div class="comment-popover" role="dialog" aria-labelledby="comment-popover-title"><div class="comment-popover-header"><div><div class="comment-popover-title" id="comment-popover-title">' +
        esc(displayName(student)) +
        '</div><div class="comment-popover-subtitle">' +
        esc(assess.title) +
        '</div></div><button class="comment-popover-close" data-action="closeCommentPopover" aria-label="Close">\u2715</button></div><div class="comment-popover-body"></div><div class="comment-popover-footer comment-popover-capture"></div></div>';
      pageState._commentCapture = ObsCapture.create({
        cid: cid,
        idPrefix: 'asg-',
        students: [sid],
        lockStudents: true,
        assessmentId: aid,
        lockAssessment: true,
        draftKey: 'asg-comment|' + sid + '|' + aid,
        placeholder: 'Add a comment\u2026',
        onAdd: function () {
          renderCommentPopover();
          updateCommentBadge(sid, aid);
        },
      });
      pageState._commentCapture.mount(overlay.querySelector('.comment-popover-capture'));
      setTimeout(function () {
        if (pageState._commentCapture) pageState._commentCapture.focus();
      }, 50);
    }
    overlay.querySelector('.comment-popover-body').innerHTML = _commentEntriesHtml(cid, sid, aid);
    overlay.style.display = 'flex';
    var input = overlay.querySelector('.comment-entry-input');
    if (input) {
      // Enter saves, Shift+Enter starts a new line, Escape cancels the edit
      // without closing the dialog.
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          saveCommentEdit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelCommentEdit();
        }
      });
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
  /* One comment at a time is edited in place; nothing is written until Save. */
  pageState._commentEditId = null;
  function editComment(obId) {
    pageState._commentEditId = obId;
    renderCommentPopover();
  }
  function cancelCommentEdit() {
    pageState._commentEditId = null;
    renderCommentPopover();
    if (pageState._commentCapture) pageState._commentCapture.focus();
  }
  function saveCommentEdit() {
    if (!pageState._commentPopoverState || !pageState._commentEditId) return;
    var cid = pageState._commentPopoverState.cid,
      sid = pageState._commentPopoverState.sid;
    var input = document.querySelector('#comment-popover-overlay .comment-entry-input');
    var text = input ? input.value.trim() : '';
    if (!text) {
      if (input) input.focus();
      return;
    }
    if (pageState._commentEditId === OVERALL_COMMENT_ID) {
      Grader.setOverallComment(cid, sid, pageState._commentPopoverState.aid, text);
    } else {
      // The comment may have been re-keyed to its server id since the list drew.
      updateQuickOb(cid, sid, resolveObservationId(cid, pageState._commentEditId), { text: text });
    }
    cancelCommentEdit();
  }
  function deleteComment(obId) {
    if (!pageState._commentPopoverState) return;
    var cid = pageState._commentPopoverState.cid,
      sid = pageState._commentPopoverState.sid,
      aid = pageState._commentPopoverState.aid;
    if (obId === pageState._commentEditId) pageState._commentEditId = null;
    var after = function () {
      renderCommentPopover();
      updateCommentBadge(sid, aid);
    };
    if (obId === OVERALL_COMMENT_ID) Grader.setOverallComment(cid, sid, aid, '');
    // An observation with follow-ups asks first (ObsFollowUps.confirmDelete).
    else if (window.ObsFollowUps)
      return ObsFollowUps.confirmDelete(cid, obId, () => (deleteQuickOb(cid, sid, obId), after()));
    else deleteQuickOb(cid, sid, obId);
    after();
  }
  function closeCommentPopover() {
    pageState._commentPopoverState = null;
    pageState._commentEditId = null;
    if (pageState._commentCapture) pageState._commentCapture.destroy();
    pageState._commentCapture = null;
    var overlay = document.getElementById('comment-popover-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.innerHTML = '';
      delete overlay.dataset.key;
    }
  }
  function updateCommentBadge(sid, aid) {
    var cid = pageState.activeCourse;
    var count = _assignmentCommentCount(cid, sid, aid);
    document.querySelectorAll('.comment-btn').forEach(function (btn) {
      if (btn.dataset.sid === sid && btn.dataset.aid === aid)
        // html-safe: count is a number
        btn.innerHTML = count > 0 ? 'Comment <span class="comment-count">' + count + '</span>' : 'Comment';
    });
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

  /* ── Delegated click handler ────────────────────────────── */
  function _handleClick(e) {
    CritComment.clickOutside(e);
    if (!e.target.closest('.rsg-group-members .grader-member-menu, .rsg-group-members .grader-member-more'))
      _closeGroupMenus();
    // A card's menu closes on any click but its own button's (an item's
    // action still runs).
    if (!e.target.closest(CardMenu.TOGGLES + ', [data-action="openCardSubmenu"]')) CardMenu.close();
    // The row's Attach a Link form closes on a click anywhere else.
    if (!e.target.closest('.rsg-attach-link, [data-action="attachWorkLink"]')) _closeAttachLink(false);
    // KB focus on score cells
    var critRow = e.target.closest('.rsg-criterion-row');
    if (critRow) {
      kbFocusCell(critRow);
    } else if (pageState._kbFocusEl && !e.target.closest('.col-fill-menu') && !e.target.closest('.row-fill-btn')) {
      kbFocusCell(null);
    }

    if (AssignToolbar.filterOpen() && !AssignToolbar.inFilter(e.target)) AssignToolbar.setFilter(false);

    // Close menus on click outside
    if (
      !e.target.closest('.col-fill-menu') &&
      !e.target.closest('.score-col-header') &&
      !e.target.closest('.row-fill-btn')
    )
      closeMenus();

    // A click in a module's name edits it; it doesn't open or close the folder.
    if (e.target.closest('.mod-folder-name-input')) return;

    // A click on a criterion's saved comment, or a line for one student,
    // opens it to edit.
    var critNote = e.target.closest('.rsg-criterion-row .rsg-crit-note, .rsg-criterion-row .rsg-crit-own-note');
    var noteBtn =
      critNote &&
      critNote.closest('.rsg-criterion-row').querySelector('.rsg-crit-comment[data-action="openCriterionComment"]');
    if (noteBtn) {
      CritComment.open(noteBtn.dataset.aid, noteBtn.dataset.sid, noteBtn.dataset.critid, critNote.dataset.own);
      return;
    }

    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.dataset.action;
    if (el.dataset.stopProp === 'true') e.stopPropagation();
    var handlers = {
      showNewForm: function () {
        showNewForm();
      },
      newQuiz: function () {
        showNewForm();
        QuizBuilder.startNew({
          open: () => pageState._showingNewForm && !pageState._editingAssessId,
          choose: () => pageState._formWork && _setFormWork('students_send', 'quiz'),
          done: _markFormStart,
        });
      },
      addFromClass: function () {
        if (window.AddFromClass) AddFromClass.open(pageState.activeCourse, render);
      },
      copyTargetToggle: function () {
        if (window.AssessmentCopy) AssessmentCopy.toggleTarget(el);
      },
      copyDatesMode: function () {
        if (window.AssessmentCopy) AssessmentCopy.setDatesMode(el);
      },
      switchToClass: function () {
        if (el.dataset.cid && el.dataset.cid !== pageState.activeCourse) switchCourse(el.dataset.cid);
      },
      openCopyIn: function () {
        openCopyIn(el.dataset.cid, el.dataset.aid);
      },
      hideNewForm: function () {
        hideNewForm();
      },
      cancelAssessForm: function () {
        cancelAssessForm();
      },
      // A class with no categories: Class Settings' Grading tab.
      // Handouts and Links (board 3a).
      afResAddFile: function () {
        var f = document.querySelector('#af-res .af-res-file');
        if (f && pageState._formRes && !pageState._formRes.busy) f.click();
      },
      afResAddLink: function () {
        _formResOpenLink();
      },
      afResLinkAdd: function () {
        _formResAddLink();
      },
      afResLinkCancel: function () {
        _formResCloseLink();
      },
      afResRemove: function () {
        _formResRemove(el.dataset.key);
      },
      afAddCategories: function () {
        var cid = pageState.activeCourse;
        cancelAssessForm(function () {
          Router.navigate('/dashboard?course=' + encodeURIComponent(cid) + '&manage=grading');
        });
      },
      toggleAssess: function () {
        toggleAssess(el.dataset.aid);
      },
      editAssess: function () {
        editAssess(el.dataset.aid);
      },
      toggleCardMenu: function () {
        CardMenu.toggle(el);
      },
      openCardSubmenu: function () {
        CardMenu.openSub(el, true);
      },
      attachWorkMenu: function () {
        _attachMenuOpen(el);
      },
      copyAssessToClass: function () {
        copyAssessToClass(el.dataset.aid);
      },
      dupeAssess: function () {
        dupeAssess(el.dataset.aid);
      },
      deleteAssess: function () {
        deleteAssess(el.dataset.aid);
      },
      closeStart: function () {
        // The Blank editor's Cancel asks first when it has writing in it.
        if (el.closest('.af-ge-card')) _cancelBlank();
        else closeStart();
      },
      startPickRow: function () {
        _startPickRow(el.dataset.rid, true);
      },
      startPickUse: function () {
        _startPickUse();
      },
      startPickNone: function () {
        _startPickNone();
      },
      useLastRubric: function () {
        pageState._startOpen = null;
        pageState._blank = null;
        _useRubricInForm(el.dataset.rid);
        _renderRubricView();
      },
      geStyle: function () {
        _blankAct('geStyle', el);
      },
      geAddCrit: function () {
        _blankAct('geAddCrit', el);
      },
      geRemoveCrit: function () {
        _blankAct('geRemoveCrit', el);
      },
      geMenu: function () {
        _blankAct('geMenu', el);
      },
      gePicker: function () {
        _blankAct('gePicker', el);
      },
      geRemoveTag: function () {
        _blankAct('geRemoveTag', el);
      },
      gePick: function () {
        _blankAct('gePick', el);
      },
      geAddCheck: function () {
        _blankAct('geAddCheck', el);
      },
      geSave: function () {
        _blankAct('geSave', el);
      },
      geDupCrit: function () {
        _blankAct('geDupCrit', el);
      },
      geColMenu: function () {
        _blankAct('geColMenu', el);
      },
      geColAdd: function () {
        _blankAct('geColAdd', el);
      },
      geColInsert: function () {
        _blankAct('geColInsert', el);
      },
      geColRemove: function () {
        _blankAct('geColRemove', el);
      },
      geMoveCrit: function () {
        _blankAct('geMoveCrit', el);
      },
      startFromPast: function () {
        startFromPast();
      },
      saveAndAddAnother: function () {
        saveNewAssess(true);
      },
      saveNewAssess: function () {
        saveNewAssess(el.dataset.draft ? 'draft' : false);
      },
      saveEditAssess: function () {
        AssignDraft.assigning = el.dataset.assign ? el.dataset.aid : null;
        saveEditAssess(el.dataset.aid);
      },
      toggleModuleFolder: function () {
        toggleModuleFolder(el.dataset.uid);
      },
      deleteModule: function () {
        deleteModule(el.dataset.uid, parseInt(el.dataset.count, 10));
      },
      addModuleInline: function () {
        addModuleInline();
      },
      openModuleColorPop: function () {
        openModuleColorPop(el);
      },
      setRubricView: function () {
        setRubricView(el.dataset.aid, el.dataset.rubric === 'true');
      },
      editRubricUI: function () {
        editRubricUI(el.dataset.rid);
      },
      deleteRubricUI: function () {
        deleteRubricUI(el.dataset.rid);
      },
      newRubricUI: function () {
        newRubricUI(el.dataset.style);
      },
      newRubricFromForm: function () {
        newRubricFromForm();
      },
      rubricFromClass: function () {
        rubricFromClass();
      },
      copyRubricUI: function () {
        if (window.RubricLibrary) RubricLibrary.openCopyDialog(pageState.activeCourse, el.dataset.rid, render);
      },
      setCollaboration: function () {
        setCollaboration(el.dataset.collab);
      },
      setFormWork: function () {
        _setFormWork(el.dataset.field, el.dataset.value);
      },
      setScoreMode: function () {
        _askBeforeScoredChange(
          'scoring',
          function () {
            setScoreMode(el.dataset.mode);
          },
          el.dataset.mode,
        );
      },
      toggleCategoryFilter: function () {
        var key = AssignToolbar.focusKey(el);
        toggleCategoryFilter(el.dataset.catid);
        AssignToolbar.refocus(key);
      },
      toggleUngraded: function () {
        var key = AssignToolbar.focusKey(el);
        pageState.showUngraded = !pageState.showUngraded;
        render();
        AssignToolbar.refocus(key);
      },
      // The Show bar (assign-show.js). To Return (S1-F2) is the page's own
      // filter: it is not combined with another option, and a second click lets go.
      setToGradeShow: function () {
        var show = el.dataset.show;
        if (show === 'toreturn') {
          var letGo = pageState._toReturnOnly;
          AssignShow.choose('all');
          pageState._toReturnOnly = !letGo;
          show = letGo ? 'all' : show;
        } else {
          pageState._toReturnOnly = false;
          show = AssignShow.choose(show);
        }
        render();
        AssignShow.afterDraw();
        var again = document.querySelector('.atb-show [data-show="' + show + '"]');
        if (again) again.focus({ preventScroll: true });
      },
      gradeSubmissions: function () {
        _openGraderOnWork(el.dataset.aid, el.dataset.sid || null);
      },
      // The + on a student's row (Attach Work).
      attachWorkFiles: function () {
        var wrap = el.closest('.rsg-attach');
        var file = wrap && wrap.querySelector('.rsg-attach-file');
        if (file) file.click();
      },
      attachWorkLink: function () {
        _openAttachLink(el);
      },
      attachLinkAdd: function () {
        _attachLinkAdd(el.closest('.rsg-attach-link'));
      },
      attachLinkCancel: function () {
        _closeAttachLink(true);
      },
      openWorkWall: function () {
        var aid = el.dataset.aid;
        if (!window.WorkWall || !pageState.activeCourse) return;
        // Grade in This Order grades in the dialog over the wall, and the
        // page under both is not drawn: it is drawn, whole, as the wall closes.
        WorkWall.open(pageState.activeCourse, aid, {
          onClose: function () {
            if (!pageState._pageBehind) return;
            render();
            var more = document.querySelector('#ac-' + aid + ' .assess-more-btn');
            if (more) more.focus({ preventScroll: true });
          },
        });
      },
      openAddWorkClass: function () {
        var aid = el.dataset.aid;
        if (!window.AddWorkClass || !pageState.activeCourse) return;
        // The page behind is drawn again as it closes, so new work shows.
        var cid = pageState.activeCourse;
        AddWorkClass.open(cid, aid, {
          onClose: function () {
            if (pageState.activeCourse !== cid || !document.getElementById('ac-' + aid)) return;
            render();
            var more = document.querySelector('#ac-' + aid + ' .assess-more-btn');
            if (more) more.focus({ preventScroll: true });
          },
        });
      },
      openQuizResults: function () {
        var cid = pageState.activeCourse;
        // The page behind is drawn again as it closes, so confirmed levels show.
        if (window.QuizResults && cid)
          QuizResults.open(cid, el.dataset.aid, {
            onClose: function () {
              if (pageState.activeCourse === cid) render();
            },
          });
      },
      returnDrafts: function () {
        _askReturnDrafts(el.dataset.aid, el);
      },
      returnOne: function () {
        _returnOne(el.dataset.aid, el.dataset.sid, el);
      },
      toggleAssessFilterMenu: function () {
        AssignToolbar.setFilter(!AssignToolbar.filterOpen());
      },
      clearFilterMenu: function () {
        pageState.filterCategories = [];
        pageState.showUngraded = false;
        render();
        AssignToolbar.refocus('.assess-filter-menu [data-action="toggleUngraded"]');
      },
      expandAllAssess: function () {
        expandAllAssess();
      },
      // A competency's I Can statements on the form, shown or hidden.
      afToggleIcans: function () {
        var list = document.getElementById(el.getAttribute('aria-controls'));
        if (!list) return;
        var open = list.hidden;
        list.hidden = !open;
        el.setAttribute('aria-expanded', String(open));
        el.classList.toggle('open', open);
      },
      collapseAllAssess: function () {
        collapseAllAssess();
      },
      clearFocusStudent: function () {
        clearFocusStudent();
      },
      openRubricBank: function () {
        openRubricBank();
      },
      clearAssessFilters: function () {
        e.preventDefault();
        pageState.filterCategories = [];
        pageState.assessSearch = '';
        pageState.showUngraded = false;
        AssignShow.choose('all');
        render();
        AssignShow.afterDraw();
      },
      selectTagLevel: function () {
        selectTagLevel(el, parseInt(el.dataset.level, 10), el.dataset.aid, el.dataset.sid, el.dataset.tagid);
      },
      toggleChecklist: function () {
        toggleChecklist(el);
      },
      tickRubricCheck: function () {
        tickRubricCheck(el);
      },
      setChecklistMode: function () {
        setChecklistMode(el.dataset.mode);
      },
      selectSixScore: function () {
        selectSixScore(el.dataset.aid, el.dataset.sid, el.dataset.critid, parseInt(el.dataset.six, 10));
      },
      graderSix: function () {
        if (e.target.closest('.grdt-check')) return;
        _graderSetLevel(_graderAid(el), el.dataset.critid, parseInt(el.dataset.six, 10));
      },
      selectRubricScore: function () {
        selectRubricScore(el, parseInt(el.dataset.level, 10), el.dataset.aid, el.dataset.sid, el.dataset.critid);
      },
      setScoreMod: function () {
        setScoreMod(el, parseInt(el.dataset.mod, 10));
      },
      setCompletion: function () {
        setCompletion(el);
      },
      confirmFillCompletion: function () {
        confirmFillCompletion(el.dataset.aid);
      },
      confirmFillPoints: function () {
        confirmFillPoints(el.dataset.aid);
      },
      confirmFillNotSubmitted: function () {
        confirmFillNotSubmitted(el.dataset.aid);
      },
      toggleScoreMenu: function () {
        toggleScoreMenu(el);
      },
      fillScoresAndClose: function () {
        fillScores(el.dataset.aid, el.dataset.sid, parseInt(el.dataset.score, 10), el.dataset.scope);
        closeMenus();
      },
      fillRubricScoresAndClose: function () {
        fillRubricScores(el.dataset.aid, el.dataset.sid, parseInt(el.dataset.score, 10), el.dataset.scope);
        closeMenus();
      },
      confirmFillAll: function () {
        confirmFillAll(el.dataset.aid, parseInt(el.dataset.score, 10), el.dataset.label);
      },
      confirmFillRubricAll: function () {
        confirmFillRubricAll(el.dataset.aid, parseInt(el.dataset.score, 10), el.dataset.label);
      },
      setDibelsPeriod: function () {
        setDibelsPeriod(el.dataset.aid, el.dataset.period);
      },
      printDibels: function () {
        printDibels(el.dataset.aid);
      },
      graderLevel: function () {
        // A tick inside an Advanced tile is its own action, not a pick, and
        // a chosen tile's − | + (a disabled one, the gap) never clears it.
        if (e.target.closest('.grdt-check, .grdt-stepper')) return;
        _graderSetLevel(_graderAid(el), el.dataset.critid, parseInt(el.dataset.level, 10));
      },
      graderChecks: function () {
        _graderToggleRow(_graderAid(el), el.dataset.critid, 'checks');
      },
      graderNote: function () {
        _graderToggleRow(_graderAid(el), el.dataset.critid, 'note');
      },
      graderTagLevel: function () {
        _graderSetTagLevel(_graderAid(el), el.dataset.tag, parseInt(el.dataset.level, 10));
      },
      graderTagMod: function () {
        _graderSetTagMod(_graderAid(el), el.dataset.tag, parseInt(el.dataset.mod, 10));
      },
      graderMark: function () {
        var aid = _graderAid(el);
        if (!aid || !pageState.focusStudentId) return;
        var now = getCompletionMark(pageState.activeCourse, pageState.focusStudentId, aid);
        Grader.setMark(
          pageState.activeCourse,
          pageState.focusStudentId,
          aid,
          now === el.dataset.mark ? null : el.dataset.mark,
        );
        refreshSidebarGrades(pageState.focusStudentId);
        render();
      },
      graderTick: function () {
        _graderTick(_graderAid(el), el.dataset.critid, el.dataset.checkid, el.checked);
      },
      graderMod: function () {
        _graderSetMod(_graderAid(el), el.dataset.critid, parseInt(el.dataset.mod, 10));
      },
      toggleStudentStatus: function () {
        toggleStudentStatus(el.dataset.aid, el.dataset.sid, el.dataset.status);
      },
      groupMemberMenu: function () {
        _toggleGroupMenu(el);
      },
      groupGradeSeparately: function () {
        Grader.gradeSeparately(pageState.activeCourse, el.dataset.aid, el.dataset.sid);
        refreshSidebarGrades();
        render();
      },
      groupBackToGroup: function () {
        _confirmBackToGroupGrade(
          pageState.activeCourse,
          _assessmentById(pageState.activeCourse, el.dataset.aid),
          el.dataset.sid,
        );
      },
      openCommentPopover: function () {
        openCommentPopover(el.dataset.cid, el.dataset.sid, el.dataset.aid);
      },
      closeCommentPopover: function () {
        closeCommentPopover();
      },
      deleteComment: function () {
        deleteComment(el.dataset.obid);
      },
      editComment: function () {
        editComment(el.dataset.obid);
      },
      saveCommentEdit: function () {
        saveCommentEdit();
      },
      cancelCommentEdit: function () {
        cancelCommentEdit();
      },
      openCriterionComment: function () {
        CritComment.open(el.dataset.aid, el.dataset.sid, el.dataset.critid);
      },
      critCommentReuse: function () {
        CritComment.reuse(parseInt(el.dataset.i, 10));
      },
      critOwnAdd: function () {
        CritComment.ownAdd(el.dataset.own);
      },
      printRubrics: function () {
        // Grading one student: their rubric. Every student showing: everyone's.
        if (window.RubricPrint)
          RubricPrint.open(pageState.activeCourse, el.dataset.aid, { studentId: pageState.focusStudentId });
      },
      toggleSectionTags: function () {
        toggleSectionTags(el.dataset.secid);
      },
      toggleSectionOpen: function () {
        el.parentElement.classList.toggle('af-section-open');
      },
      toggleActive: function () {
        var on = el.classList.toggle('active');
        if (el.hasAttribute('aria-pressed')) el.setAttribute('aria-pressed', String(on));
      },
      chooseRubric: function () {
        chooseRubric();
      },
      cancelRubricPick: function () {
        cancelRubricPick();
      },
      editRubricFromForm: function () {
        editRubricFromForm();
      },
      useCompetencyRubric: function () {
        useCompetencyRubric();
      },
      editMyWording: function () {
        editMyWording();
      },
      toggleChooseStudents: function () {
        AC.toggleChooseStudents();
      },
      toggleCode: function () {
        toggleCode(el);
      },
      setCompView: function () {
        setCompView(el.dataset.view);
      },
      openCompPicker: function () {
        openCompPicker();
      },
      closeCompPicker: function () {
        closeCompPicker(false);
      },
      cancelCompPicker: function () {
        closeCompPicker(true);
      },
      removeComp: function () {
        _removeComp(el.dataset.tag);
      },
      collabToggleStudent: function () {
        collabToggleStudent(el.dataset.sid);
      },
      collabUndoMove: function () {
        AC.collabUndoMove();
        _syncCollabState();
      },
      collabCheckAll: function () {
        collabCheckAll();
      },
      collabCheckNone: function () {
        collabCheckNone();
      },
      collabRandomPairs: function () {
        collabRandomPairs();
      },
      collabManualPairs: function () {
        collabManualPairs();
      },
      collabRandomGroups: function () {
        collabRandomGroups();
      },
      collabManualGroups: function () {
        collabManualGroups();
      },
      collabSetGroupCount: function () {
        collabSetGroupCount(parseInt(el.dataset.delta, 10));
      },
      rubricModalBackdrop: function () {
        if (e.target === el) cancelRubricEdit();
      },
      cancelRubricEdit: function () {
        cancelRubricEdit();
      },
      saveRubricEdit: function () {
        saveRubricEdit();
      },
      stepFactor: function () {
        FactorField.stepIn(document.getElementById('af-weight'), Number(el.dataset.dir));
      },
      setMaxPoints: function () {
        var mp = document.getElementById('af-maxpoints');
        if (mp) {
          mp.value = el.dataset.value;
          _formInput({ target: mp });
        } else segSelect(el);
      },
    };
    if (handlers[action]) {
      // A label inside the control (a checklist line on an Advanced tile)
      // keeps its own click, which ticks its box.
      var innerLabel = e.target.closest('label');
      var ownLabel = innerLabel && innerLabel !== el && el.contains(innerLabel);
      if (action !== 'rubricModalBackdrop' && el.tagName !== 'SELECT' && !ownLabel) e.preventDefault();
      handlers[action]();
    }
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

  function _handleKeydown(e) {
    if (
      pageState._fillUndoOpen &&
      (e.metaKey || e.ctrlKey) &&
      !e.shiftKey &&
      (e.key === 'z' || e.key === 'Z') &&
      !(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable))
    ) {
      e.preventDefault();
      executeUndo();
      return;
    }
    // Escape closes an open fill menu (it used to stay open).
    if (e.key === 'Escape' && document.querySelector('.col-fill-menu.open')) {
      e.preventDefault();
      closeMenus();
      return;
    }
    if (CardMenu.keydown(e)) return;
    if (_attachLinkKeydown(e)) return;
    // One student's grader open on the page (the dialog runs its own).
    if (!pageState._grader && _graderCardKey(e)) return;
    if (e.key === 'Escape' && document.querySelector('.rsg-group-members .grader-member-menu:not([hidden])')) {
      e.preventDefault();
      _closeGroupMenus();
      return;
    }
    if (pageState._chipTipSource && e.key === 'Escape') {
      var focusedChip = e.target === pageState._chipTipSource;
      _hideChipTip();
      if (focusedChip) return;
    }
    if (AssignToolbar.filterOpen() && e.key === 'Escape') {
      e.preventDefault();
      AssignToolbar.setFilter(false);
      var trigger = document.querySelector('.atb-filter-btn');
      if (trigger) trigger.focus();
      return;
    }
    // A module name: Enter saves, Escape puts back the saved name.
    if (e.target && e.target.dataset && e.target.dataset.actionBlur === 'moduleName') {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.target.value = _moduleNameSaved(e.target);
        e.target.blur();
      }
      return;
    }
    // The Rubric Bank window handles its own keys.
    if (window.RubricBank && RubricBank.isOpen()) return;
    // The criterion comment field's Tab, Enter and Escape (scoring keys
    // never reach the grid while typing in it).
    if (CritComment.key(e)) return;
    // An overall comment the criterion comments led to: Tab goes on to the
    // next student's or group's first criterion comment, Shift+Tab back.
    if (CritComment.flowKey(e)) return;
    var ldgRow = document.activeElement.closest && document.activeElement.closest('.ldg-row.ldg-cmp');
    // Typing in the row's Overall Comment, or in its + menu and Link…
    // form, is not a c / i answer.
    if (
      ldgRow &&
      document.activeElement.tagName !== 'TEXTAREA' &&
      !document.activeElement.closest('.rsg-attach') &&
      handleLedgerKey(e, ldgRow)
    )
      return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      // Handle points keyboard navigation
      if (document.activeElement.classList.contains('gb-pts-input')) {
        handlePointsKey(e, document.activeElement);
      }
      return;
    }
    if (
      pageState.focusStudentId &&
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey &&
      !document.getElementById('rubric-modal') &&
      !document.querySelector('.confirm-overlay')
    ) {
      e.preventDefault();
      stepFocusStudent(e.key === 'ArrowRight' ? 1 : -1);
      return;
    }
    if (!pageState._kbFocusEl) return;
    var key = e.key;
    // A Six-Point row takes 1 to 6, the scores themselves.
    var sixRow = pageState._kbFocusEl.classList.contains('is-six');
    if (sixRow && ['1', '2', '3', '4', '5', '6'].includes(key)) {
      e.preventDefault();
      var six = pageState._kbFocusEl.querySelector('.sp6-btn[data-six="' + key + '"]');
      if (six) six.click();
      navigateKb('down');
      return;
    }
    if (sixRow && ['+', '=', '-', '_'].includes(key)) {
      e.preventDefault();
      return;
    }
    if (['1', '2', '3', '4'].includes(key)) {
      e.preventDefault();
      var val = parseInt(key, 10);
      if (pageState._kbFocusEl.classList.contains('rsg-criterion-row')) {
        var lvl = pageState._kbFocusEl.querySelector('.l' + val);
        if (lvl) lvl.click();
      }
      navigateKb('down');
      return;
    }
    if (
      (key === 'k' || key === 'K') &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      pageState._kbFocusEl.classList.contains('rsg-criterion-row') &&
      !document.getElementById('rubric-modal') &&
      !document.querySelector('.confirm-overlay')
    ) {
      var checksBtn = pageState._kbFocusEl.querySelector('.rsg-checks-btn');
      if (checksBtn) {
        e.preventDefault();
        checksBtn.click();
      }
      return;
    }
    if (
      (key === 'c' || key === 'C') &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      pageState._kbFocusEl.classList.contains('rsg-criterion-row') &&
      !document.getElementById('rubric-modal') &&
      !document.querySelector('.confirm-overlay')
    ) {
      var commentBtn = pageState._kbFocusEl.querySelector('.rsg-crit-comment');
      if (commentBtn) {
        e.preventDefault();
        commentBtn.click();
      }
      return;
    }
    if (['+', '=', '-', '_'].includes(key) && pageState._kbFocusEl.classList.contains('rsg-criterion-row')) {
      e.preventDefault();
      setScoreMod(pageState._kbFocusEl, key === '+' || key === '=' ? 1 : -1);
      // Its keyup lands on what has the browser's focus, perhaps another row.
      _afterGradingEvent({ type: 'keydown', target: pageState._kbFocusEl });
      return;
    }
    if (key === '0' || key === 'Backspace' || key === 'Delete') {
      e.preventDefault();
      if (pageState._kbFocusEl.classList.contains('rsg-criterion-row')) {
        var active = pageState._kbFocusEl.querySelector('.rsg-level.active');
        // Delete clears a mixed competency too, not sets it to the lowest.
        if (active) active.classList.remove('mixed');
        if (active) active.click();
      }
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
      e.preventDefault();
      navigateKb(key.replace('Arrow', '').toLowerCase());
      return;
    }
    if (key === 'Escape') {
      kbFocusCell(null);
      return;
    }
  }

  /* ── Drag event handlers (delegated) ────────────────────── */
  function _handleDragStart(e) {
    // Collab drag must be checked FIRST — members are nested inside assess cards
    var collabDrag = e.target.closest('[data-collab-drag-sid]');
    if (collabDrag) {
      collabDragStart(e, collabDrag.dataset.collabDragSid, parseInt(collabDrag.dataset.collabDragGroup, 10));
      return;
    }
    var assessDrag = e.target.closest('[data-assess-drag]');
    if (assessDrag) {
      onAssessDragStart(e, assessDrag.dataset.assessDrag);
      return;
    }
    var moduleDrag = e.target.closest('[data-module-drag]');
    if (moduleDrag) {
      onModuleDragStart(e, moduleDrag.dataset.moduleDrag);
      return;
    }
  }
  function _handleDragEnd(e) {
    // A student dropped nowhere, or back where they were, comes back into view.
    AC.collabDragEnd();
    if (pageState._dragAssessId) {
      onAssessDragEnd();
      return;
    }
    if (pageState._dragModuleId) {
      onModuleDragEnd();
      return;
    }
    pageState._dragSid = null;
    pageState._dragFromGroup = null;
  }
  function _handleDragOver(e) {
    // Module drop zone
    var dropZone = e.target.closest('[data-mod-drop-zone]');
    if (dropZone && pageState._dragModuleId) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      dropZone.classList.add('drag-over');
      return;
    }
    // Over a card: reorder (check BEFORE folder drop — cards are inside folders)
    var cardDrop = e.target.closest('[data-assess-card-drop]');
    if (cardDrop && pageState._dragAssessId && !pageState._dragModuleId) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.mod-folder.drag-over').forEach(function (el) {
        el.classList.remove('drag-over');
      });
      var targetId = cardDrop.dataset.assessCardDrop;
      if (targetId === pageState._dragAssessId) {
        _clearDropMarker();
        _clearMergeState();
        return;
      }
      var rect = cardDrop.getBoundingClientRect();
      var y = e.clientY - rect.top;
      if (y > rect.height / 3 && y < (rect.height * 2) / 3 && _canStack(pageState._dragAssessId, targetId)) {
        // Middle third: hold to stack the two into a new module.
        _clearDropMarker();
        if (pageState._mergeTargetId === targetId) return;
        _clearMergeState();
        pageState._mergeTargetId = targetId;
        pageState._mergeHoverTimer = setTimeout(function () {
          pageState._mergeAnimating = true;
          var el = document.getElementById('ac-' + targetId);
          if (el) el.classList.add('merge-target');
        }, 300);
        return;
      }
      // Top or bottom: reorder.
      if (pageState._mergeTargetId) _clearMergeState();
      _setDropMarker(cardDrop, y > rect.height / 2);
      return;
    }
    // Folder drop
    var folderDrop = e.target.closest('[data-folder-drop]');
    if (folderDrop && !pageState._dragModuleId && pageState._dragAssessId) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!folderDrop.classList.contains('drag-over')) folderDrop.classList.add('drag-over');
      return;
    }
    // Collab group drop
    var collabDrop = e.target.closest('[data-collab-drop]');
    if (collabDrop) {
      e.preventDefault();
      collabDrop.classList.add('drag-over');
      return;
    }
  }
  function _handleDragLeave(e) {
    var dropZone = e.target.closest('[data-mod-drop-zone]');
    if (dropZone) {
      dropZone.classList.remove('drag-over');
      return;
    }
    // Card leave (check before folder — cards are inside folders)
    var cardDrop = e.target.closest('[data-assess-card-drop]');
    if (cardDrop) {
      if (cardDrop.contains(e.relatedTarget)) return;
      cardDrop.classList.remove('drop-before', 'drop-after');
      if (pageState._mergeTargetId === cardDrop.dataset.assessCardDrop) _clearMergeState();
      return;
    }
    var folderDrop = e.target.closest('[data-folder-drop]');
    if (folderDrop && !folderDrop.contains(e.relatedTarget)) {
      folderDrop.classList.remove('drag-over');
      return;
    }
    var collabDrop = e.target.closest('[data-collab-drop]');
    if (collabDrop) {
      collabDrop.classList.remove('drag-over');
      return;
    }
  }
  function _handleDrop(e) {
    // Module drop zone
    var dropZone = e.target.closest('[data-mod-drop-zone]');
    if (dropZone && pageState._dragModuleId) {
      onModuleDropZoneDrop(e, parseInt(dropZone.dataset.dropIndex, 10));
      return;
    }
    // Card drop: reorder (check before folder — cards are inside folders)
    var cardDrop = e.target.closest('[data-assess-card-drop]');
    if (cardDrop && pageState._dragAssessId && !pageState._dragModuleId) {
      e.preventDefault();
      e.stopPropagation();
      var dragId = pageState._dragAssessId;
      var stackOn = pageState._mergeAnimating && pageState._mergeTargetId === cardDrop.dataset.assessCardDrop;
      var after = cardDrop.classList.contains('drop-after');
      var placed = after || cardDrop.classList.contains('drop-before');
      _clearDropMarker();
      _clearMergeState();
      pageState._dragAssessId = null;
      if (stackOn && dragId !== cardDrop.dataset.assessCardDrop) {
        mergeToNewModule(dragId, cardDrop.dataset.assessCardDrop);
        return;
      }
      if (placed && dragId !== cardDrop.dataset.assessCardDrop)
        reorderAssessment(dragId, cardDrop.dataset.assessCardDrop, after);
      return;
    }
    // Folder drop
    var folderDrop = e.target.closest('[data-folder-drop]');
    if (folderDrop && pageState._dragAssessId) {
      folderDrop.classList.remove('drag-over');
      onFolderDrop(e, folderDrop.dataset.folderDrop);
      return;
    }
    // Collab drop
    var collabDropEl = e.target.closest('[data-collab-drop]');
    if (collabDropEl) {
      collabDrop(e, parseInt(collabDropEl.dataset.collabDrop, 10));
      return;
    }
  }

  /* ── Mouseenter/mouseleave for rubric tooltips ──────────── */
  function _handleMouseOver(e) {
    var chip = e.target.closest('[data-chip-tip]');
    if (chip && chip !== pageState._chipTipSource) _showChipTip(chip);
    var nameLabel = e.target.closest('.rsg-criterion-label');
    if (nameLabel && nameLabel !== pageState._chipTipSource && Date.now() - pageState._lastTouch > 800)
      _queueNameTip(nameLabel);
  }
  function _handleMouseOut(e) {
    var chip = e.target.closest('[data-chip-tip]');
    if (chip && chip === pageState._chipTipSource && !(e.relatedTarget && chip.contains(e.relatedTarget)))
      _hideChipTip();
    var nameLabel = e.target.closest('.rsg-criterion-label');
    if (nameLabel && !(e.relatedTarget && nameLabel.contains(e.relatedTarget))) {
      clearTimeout(pageState._nameTipTimer);
      // A tap's emulated mouseout (a mouse pointer left elsewhere) is not
      // the finger leaving: the tip a tap showed stays until the next tap.
      if (nameLabel === pageState._chipTipSource && Date.now() - pageState._lastTouch > 800) _hideChipTip();
    }
  }

  /* "New Rubric" and "Criterion 2" are real names, so a rubric or criterion
     saved untouched still has one. Typing used to go in front of them ("Lab
     Report RubricNew Rubric"); the default name is now selected when its box
     gets the focus, so typing replaces it (Nov 3 sweep). */
  var DEFAULT_NAME_RE = /^(New Rubric|Criterion \d+)$/;
  function _selectDefaultName(e) {
    var t = e.target;
    if (!t || (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') || !DEFAULT_NAME_RE.test(t.value)) return;
    if (!t.closest('#rubric-modal, #new-assess-form')) return;
    t.select();
    // A click that gave the focus would put the caret back on mouseup.
    var keep = function (ev) {
      if (ev.target === t) ev.preventDefault();
    };
    t.addEventListener('mouseup', keep, { once: true });
    setTimeout(function () {
      t.removeEventListener('mouseup', keep);
    }, 500);
  }

  // The last touch, so a tap's emulated mouse events are not read as a hover.
  pageState._lastTouch = 0;
  function _handlePointerDown(e) {
    var nameLabel = e.target.closest && e.target.closest('.rsg-criterion-label');
    if (pageState._chipTipSource && pageState._chipTipSource.classList.contains('rsg-criterion-label')) _hideChipTip();
    else if (nameLabel && e.pointerType === 'touch' && _hasNameTip(nameLabel)) _showChipTip(nameLabel);
    if (e.pointerType === 'touch') pageState._lastTouch = Date.now();
  }

  /* ── Grader dialog ───────────────────────────────────────
     The gradebook's cell editor: this page's grading controls for one
     assessment and one student, in a dialog over the gradebook. While it is
     open, render() draws the dialog instead of the page, and this page's
     listeners run alongside the gradebook's (which stand aside, see
     PageAssignments.graderOpen). */
  pageState._grader = null;
  // True from a dialog over this page closing until the page is next drawn.
  pageState._pageBehind = false;

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
      var fill = e.target.closest('.grader-setto-menu [data-action="graderSetTo"]');
      if (fill) return _graderWorkAction('work-setto', fill);
      // Side by Side: a click on a page shows it full width, scrolled to it.
      var tile = e.target.closest('.grader-work-pages.fit-all .grader-work-page');
      if (tile) return _graderWorkEnlarge(tile);
      var btn = e.target.closest('[data-grader]');
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
      if (e.target.classList.contains('grader-work-files')) _graderAddWorkFiles(e.target);
    });
    // A click anywhere but the open ⋯ menu closes it.
    overlay.addEventListener('mousedown', function (e) {
      if (
        !pageState._grader ||
        !pageState._grader.menuSid ||
        e.target.closest('.grader-member-menu, .grader-member-more, .grader-change-one-btn')
      )
        return;
      pageState._grader.menuSid = null;
      _refreshGraderChrome();
    });
    // The Note for the Report: the preview follows each key, the note saves
    // on Enter or leaving the box (and so before Done, a step or closing).
    overlay.addEventListener('input', function (e) {
      if (e.target.classList.contains('grader-report-note-input')) _reportNotePreview(e.target);
      // An answer being written is kept while the dialog redraws (S10-F3).
      if (e.target.classList.contains('grader-reflect-input') && pageState._grader)
        pageState._grader.reflectDrafts[e.target.dataset.id] = e.target.value;
    });
    overlay.addEventListener('change', function (e) {
      if (e.target.classList.contains('grader-report-note-input')) _saveReportNote(e.target);
    });
    overlay.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || !e.target.classList.contains('grader-report-note-input')) return;
      e.preventDefault();
      e.target.blur();
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
    overlay.querySelector('.grader-dialog').focus({ preventScroll: true });
    // Points work: the box is ready to type in.
    _focusGraderPoints(aid);
  }

  /* Escape closes the dialog once nothing inside it (a comment box, the
     rubric window, a confirm) is using the key. In a points box it first
     puts back the saved points (_graderCardKey); a second Escape closes. */
  function _graderKeydown(e) {
    if (!pageState._grader || e.defaultPrevented) return;
    // ⌘/Ctrl+Enter: Return & Next, from anywhere in the dialog, a comment box too.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      var rn = pageState._grader.overlay.querySelector('[data-grader="return-next"]:not(:disabled)');
      if (rn && !pageState._grader.caughtUp && !CritComment.isOpen() && !pageState._commentPopoverState) {
        e.preventDefault();
        _graderReturnNext();
        return;
      }
    }
    if (_graderCardKey(e)) return;
    if (e.key !== 'Escape') return;
    var t = e.target;
    var typing =
      t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type !== 'checkbox'));
    if (typing) return;
    if (CritComment.isOpen() || pageState._commentPopoverState) return;
    if (document.getElementById('rubric-modal') || document.querySelector('.confirm-overlay')) return;
    if (window.RubricBank && RubricBank.isOpen()) return;
    e.preventDefault();
    if (pageState._grader.menuSid) {
      pageState._grader.menuSid = null;
      _refreshGraderChrome();
      return;
    }
    closeGrader();
  }

  /* Keys on a grader card, in the dialog or on the page: Enter in a points
     box saves it and moves to the next student's box; Escape puts back the
     saved points and leaves the box (a second Escape, or one with nothing
     typed, closes the dialog);
     1–4 picks a level and + / − fine-tunes it on a focused criterion or
     competency card, and ↓ / ↑ move to the next or previous one. True when
     the key was used. */
  function _graderCardKey(e) {
    var t = e.target;
    var cls = t && t.classList;
    if (!cls) return false;
    if (e.key === 'Enter' && cls.contains('grdp-input')) {
      e.preventDefault();
      var enterAid = _graderAid(t);
      t.blur();
      stepFocusStudent(1);
      _focusGraderPoints(enterAid);
      return true;
    }
    // ← → in the points box change student, as the hint says, while the
    // box holds the saved points (nothing new typed); once the teacher
    // types, they move the caret to fix a typo.
    if (
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
      cls.contains('grdp-input') &&
      pageState._grader &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey
    ) {
      var arrowAid = _graderAid(t);
      var held =
        arrowAid && pageState.focusStudentId
          ? getPointsScore(pageState.activeCourse, pageState.focusStudentId, arrowAid)
          : null;
      if (t.value.trim() !== (held != null ? formatPoints(held) : '')) return false;
      e.preventDefault();
      stepFocusStudent(e.key === 'ArrowRight' ? 1 : -1);
      return true;
    }
    if (e.key === 'Escape' && cls.contains('grdp-input')) {
      e.preventDefault();
      var escAid = _graderAid(t);
      var saved =
        escAid && pageState.focusStudentId
          ? getPointsScore(pageState.activeCourse, pageState.focusStudentId, escAid)
          : null;
      var savedText = saved != null ? formatPoints(saved) : '';
      // Nothing typed: nothing to put back, so the dialog closes at once.
      if (pageState._grader && t.value.trim() === savedText) {
        closeGrader();
        return true;
      }
      t.value = savedText;
      t.blur();
      return true;
    }
    var card = cls.contains('grdt-crit') ? t : null;
    var tagCard = cls.contains('grdl-card') ? t : null;
    if (!(card || tagCard) || e.metaKey || e.ctrlKey || e.altKey) return false;
    var aid = _graderAid(t);
    var up = e.key === '+' || e.key === '=';
    // A Six-Point criterion takes 1 to 6, the scores themselves.
    if (card && card.classList.contains('is-six') && ['5', '6'].indexOf(e.key) >= 0) {
      e.preventDefault();
      _graderSetLevel(aid, card.dataset.critid, parseInt(e.key, 10));
      return true;
    }
    if (['1', '2', '3', '4'].indexOf(e.key) >= 0) {
      e.preventDefault();
      if (card) _graderSetLevel(aid, card.dataset.critid, parseInt(e.key, 10));
      else _graderSetTagLevel(aid, tagCard.dataset.tag, parseInt(e.key, 10));
      return true;
    }
    if (up || e.key === '-' || e.key === '_') {
      e.preventDefault();
      if (card) _graderSetMod(aid, card.dataset.critid, up ? 1 : -1);
      else _graderSetTagMod(aid, tagCard.dataset.tag, up ? 1 : -1);
      return true;
    }
    // ↓ and ↑ move to the next and previous criterion or competency, so
    // 1–4 scores it; they used to scroll the dialog and leave the focus.
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.shiftKey) {
      var root = _graderRoot(aid);
      var cards = root ? Array.prototype.slice.call(root.querySelectorAll(card ? '.grdt-crit' : '.grdl-card')) : [];
      var to = cards[cards.indexOf(t) + (e.key === 'ArrowDown' ? 1 : -1)];
      e.preventDefault();
      if (to) {
        to.focus({ preventScroll: true });
        _scrollIntoViewIfNeeded(to, { block: 'nearest' });
      }
      return true;
    }
    return false;
  }

  function _renderGrader() {
    var cid = pageState.activeCourse;
    var dialog = pageState._grader.overlay.querySelector('.grader-dialog');
    var a = getAssessments(cid).find(function (x) {
      return x.id === pageState._grader.aid;
    });
    var st = getStudents(cid).find(function (x) {
      return x.id === pageState.focusStudentId;
    });
    if (!a || !st) {
      closeGrader();
      return;
    }
    // The toolbar and student header are drawn once and only updated, so a
    // save that redraws the controls (a points box on blur) doesn't swap out
    // the button being clicked.
    // The student's work beside the scoring (S6-F1), while the piece takes
    // work; the dialog is otherwise as it always was.
    var work = GraderWork.workShown(cid, a);
    if (!dialog.firstChild || pageState._grader.workShell !== work) {
      if (dialog.firstChild) _graderForgetDrawn();
      // html-safe: fixed markup and icon constants; text is set with textContent below
      dialog.innerHTML = work ? _graderWorkShellHtml() : _graderShellHtml();
      pageState._grader.workShell = work;
    }
    dialog.classList.toggle('has-work', work);
    dialog.classList.toggle('is-focus', work && pageState._grader.work.focus);
    // Group work shows the group: its grade is drawn from (and saved for)
    // the member it copies from, so that member is the focus.
    var view = _graderGroupView(cid, a, st.id);
    if (view && view.source !== st.id) {
      pageState.focusStudentId = view.source;
      st = getStudents(cid).find(function (x) {
        return x.id === view.source;
      });
    }
    _graderWorkStudentChanged();
    _drawGraderToolbar(dialog, cid, a);
    _drawGraderHead(_graderPart(dialog, 'head'), cid, a, st, view);
    pageState._grader.source = view ? view.source : null;
    _drawGraderPanel(_graderPart(dialog, 'panel'), cid, a, st);
    if (work) _drawGraderWork(dialog, cid, a, st, view);
    _refreshGraderReflection(dialog, cid, a, st);
    _refreshGraderChrome();
  }

  /* ── Grader parts (S6-T1) ─────────────────────────────────
     The dialog is put together from four parts, each with its own markup
     and its own drawing, so a work pane can sit beside the scoring
     without either knowing where the other is:
     - the toolbar: Print, the title, Needs a Category, Counts As, Done;
     - the head: ← the student's (or group's) name →, Printed, and the
       Missing | Excused | Late control;
     - the panel: Graded Separately From, the members card, the grading
       controls and the Note for the Report;
     - the foot: the hint and the grade.
     Today they sit as they always have: the head and the panel share the
     part that scrolls, between the toolbar and the foot, and the markup is
     the same to the byte (tests/fixtures/assignments-switch-off.json).
     Each part is drawn and refreshed through its own root, found by
     _graderPart, so a layout that moves the head above a work pane, or the
     panel into a column of its own, changes the shell and nothing else.
     The panel is four siblings, not one box: its root is the element that
     holds them (today the scrolling part). */
  // html-safe: fixed markup
  function _graderToolbarHtml() {
    return (
      '<div class="grader-toolbar">' +
      '<div class="grader-toolbar-start"></div>' +
      '<div class="grader-title-wrap"><h2 class="grader-title" id="grader-title"></h2>' +
      '<span class="type-badge type-badge-needs grader-needs-category" hidden></span>' +
      '<p class="grader-counts-as"></p></div>' +
      '<div class="grader-toolbar-end"><button type="button" class="grader-done" data-grader="close">Done</button></div>' +
      '</div>'
    );
  }

  // html-safe: fixed markup and icon constants
  function _graderHeadHtml() {
    return (
      '<div class="grader-student-row">' +
      '<button type="button" class="grader-step" data-grader="prev" aria-label="Previous student">' +
      _GRADER_CHEVRON_LEFT +
      '</button>' +
      '<h1 class="grader-student"></h1>' +
      '<button type="button" class="grader-step" data-grader="next" aria-label="Next student">' +
      _GRADER_CHEVRON_RIGHT +
      '</button>' +
      '<span class="grader-print-mark"></span>' +
      '<span class="grader-spacer"></span>' +
      '<div class="grader-status" role="group" aria-label="Status"></div>' +
      '</div>'
    );
  }

  // html-safe: fixed markup
  function _graderPanelHtml() {
    return (
      '<div class="grader-separate-line" hidden></div>' +
      '<section class="grader-members" aria-labelledby="grader-members-title" hidden></section>' +
      '<div class="grader-body"></div>' +
      // Closed unless a note is written (Colin, Nov 13: teachers were
      // confused by the open box). One quiet line until it is opened.
      '<details class="grader-report-note">' +
      '<summary class="grader-report-note-head"><h2 id="grader-report-note-title">Note for the Report</h2>' +
      '<span class="grader-report-note-opt">Optional</span></summary>' +
      '<div class="grader-report-note-body">' +
      '<p class="grader-report-note-what">If this is the student\u2019s best piece, their report comment names it. Write what they did well and the comment adds it.</p>' +
      '<input type="text" class="grader-report-note-input" aria-label="Note for the report" ' +
      'placeholder="e.g. used evidence from two sources to explain the causes" ' +
      'aria-describedby="grader-report-note-preview" maxlength="300" autocomplete="off">' +
      '<p class="grader-report-note-preview" id="grader-report-note-preview"></p>' +
      '</div>' +
      '</details>'
    );
  }

  // html-safe: fixed markup
  function _graderFootHtml() {
    return (
      '<div class="grader-foot">' +
      '<span class="grader-hint">← → change student · Esc closes</span>' +
      '<span class="grader-grade-label">Grade</span><span class="grader-grade"></span>' +
      '</div>'
    );
  }

  // The dialog as it has always been laid out.
  // html-safe: the parts' fixed markup
  function _graderShellHtml() {
    return (
      _graderToolbarHtml() +
      '<div class="grader-scroll">' +
      _graderHeadHtml() +
      _graderPanelHtml() +
      '</div>' +
      _graderFootHtml()
    );
  }

  /* A part's root in the dialog: the head's row; the element holding the
     panel's pieces; the toolbar; the foot. Null when the dialog has none. */
  function _graderPart(dialog, part) {
    if (!dialog) return null;
    if (part === 'head') return dialog.querySelector('.grader-student-row');
    if (part === 'panel') {
      var body = dialog.querySelector('.grader-body');
      return body ? body.parentNode : null;
    }
    if (part === 'toolbar') return dialog.querySelector('.grader-toolbar');
    if (part === 'foot') return dialog.querySelector('.grader-foot');
    return null;
  }

  function _drawGraderToolbar(dialog, cid, a) {
    var bar = _graderPart(dialog, 'toolbar');
    bar.querySelector('.grader-title').textContent = a.title || 'Assessment';
    bar.querySelector('.grader-counts-as').textContent = _countsAsText(cid, a);
    var needsCat = bar.querySelector('.grader-needs-category');
    needsCat.hidden = !assessmentNeedsCategory(cid, a);
    needsCat.textContent = NEEDS_CATEGORY_LABEL;
    needsCat.title = NEEDS_CATEGORY_TIP;
    // html-safe: _graderPrintButton is fixed labels and our id
    bar.querySelector('.grader-toolbar-start').innerHTML = _graderPrintButton(cid, a);
  }

  /* The head for `st` (the member a group's grade is drawn from, when
     `view` is a group): the name, and ← → off at either end. */
  function _drawGraderHead(head, cid, a, st, view) {
    var i = pageState._grader.studentIds.indexOf(st.id);
    var steps = _graderSteps(cid, a);
    var u = steps ? _graderUnitIndex(steps, st.id) : -1;
    var prev = head.querySelector('[data-grader="prev"]');
    var next = head.querySelector('[data-grader="next"]');
    head.querySelector('.grader-student').textContent = view ? view.label : displayNameWithLast(st);
    prev.disabled = steps ? !(u > 0) : !(i > 0);
    next.disabled = steps
      ? !(u >= 0 && u < steps.length - 1)
      : !(i >= 0 && i < pageState._grader.studentIds.length - 1);
    prev.setAttribute('aria-label', view ? 'Previous' : 'Previous student');
    next.setAttribute('aria-label', view ? 'Next' : 'Next student');
  }

  // The grading controls for `st`.
  function _drawGraderPanel(panel, cid, a, st) {
    var body = panel.querySelector('.grader-body');
    // Students in This Group may sit among the criteria: keep it out of
    // the redraw (_placeGroupMembers puts it back).
    var members = panel.querySelector('.grader-members');
    if (members && body.contains(members)) body.parentNode.insertBefore(members, body);
    // html-safe: a.id is our id; _graderHtml is reviewed
    body.innerHTML =
      '<div class="assess-card open active" id="ac-' +
      a.id +
      '"><div class="assess-body">' +
      _graderHtml(cid, a, _scoreTagObjs(cid, a), [st], getScores(cid), true) +
      '</div></div>';
  }

  /* The head after a click: the Missing | Excused | Late control (none on
     a group, whose members each have their own) and Printed beside the
     name. Each is redrawn only when it changes: pressing a button moves
     focus, which runs this, and new buttons under the mouse before it is
     released lose the click. */
  function _refreshGraderHead(head, cid, a, sid, view) {
    var status = getAssignmentStatus(cid, sid, a.id);
    // A DIBELS benchmark is given on the day or not at all: no Late.
    var statusHtml = _graderStatusButtons(a.id, sid, status, isDibelsScored(a) ? ['NS', 'EXC'] : ['NS', 'EXC', 'LATE']);
    var statusBox = head.querySelector('.grader-status');
    if (pageState._grader.statusHtml !== statusHtml) {
      // html-safe: statusHtml is built by _graderStatusButtons
      if (!_patchStatusButtons(statusBox, statusHtml)) statusBox.innerHTML = statusHtml;
      pageState._grader.statusHtml = statusHtml;
    }
    statusBox.hidden = !!view;
    // Printed / Changed Since Printed beside the name (teacher/rubric-print.js).
    var markHtml = view ? '' : _printMarkHtml(cid, a.id, sid);
    var markBox = head.querySelector('.grader-print-mark');
    if (markBox && pageState._grader.markHtml !== markHtml) {
      // html-safe: _printMarkHtml is RubricPrint.markHtml, which escapes its text
      markBox.innerHTML = markHtml;
      pageState._grader.markHtml = markHtml;
    }
  }

  /* The panel after a click: the members card and the Graded Separately
     From line, the controls set aside under Missing or Excused, and the
     Note for the Report (one student's; the group view has none). */
  function _refreshGraderPanel(panel, cid, a, sid, view) {
    _refreshGroupChrome(panel, cid, a, sid, view);
    var status = getAssignmentStatus(cid, sid, a.id);
    // Missing and Excused set the grading controls aside, as the grids do.
    panel.querySelector('.grader-body').classList.toggle('is-locked', status === 'NS' || status === 'EXC');
    _refreshReportNote(panel, cid, a, sid);
    if (view) panel.querySelector('.grader-report-note').hidden = true;
  }

  var _GRADER_CHEVRON_LEFT =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
  var _GRADER_CHEVRON_RIGHT =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
  var _GRADER_PRINTER =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/></svg>';

  /* The card's label for the same print: Print Rubrics on rubric and
     competency-level work (a graded rubric), Print Scores on points and
     Complete/Incomplete work (the score or mark and feedback); none on DIBELS. */
  // html-safe: fixed labels and icon; a.id is our id
  function _graderPrintButton(cid, a) {
    if (isDibelsScored(a)) return '';
    var hasRubric = a.rubricId && getRubricById(cid, a.rubricId);
    var label = !hasRubric && isPointsScored(a) ? 'Print Scores' : 'Print Rubrics';
    return (
      '<button type="button" class="grader-print" data-action="printRubrics" data-aid="' +
      a.id +
      '">' +
      _GRADER_PRINTER +
      label +
      '</button>'
    );
  }

  var _SUGGESTED_ICON =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>';
  var _NOT_SCORED_ICON =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/></svg>';
  AssignCards.configure({ _NOT_SCORED_ICON: _NOT_SCORED_ICON });
  var _GRADER_STATUS_LABELS = { NS: 'Missing', EXC: 'Excused', LATE: 'Late' };
  // Missing and Excused are greyed out on work with a score or feedback
  // (canSetAssignmentStatus, shared/data.js).
  // It says why, and what to do (Nov 3 sweep).
  var _STATUS_LOCKED_TITLE =
    'This student has a score or feedback on this work. Clear it first to mark Missing or Excused.';
  function _statusLockAttrs(aid, sid, key) {
    return canSetAssignmentStatus(pageState.activeCourse, sid, aid, key)
      ? ''
      : ' disabled title="' + _STATUS_LOCKED_TITLE + '"';
  }
  // Brings the status buttons up to date after a score or comment changes,
  // without redrawing anything: every one on the page, or those of the
  // piece of work (and student) in `scope` (_eventScope).
  function _syncStatusLocks(scope) {
    var sel = '[data-action="toggleStudentStatus"]';
    if (scope) sel += '[data-aid="' + scope.aid + '"]' + (scope.sid ? '[data-sid="' + scope.sid + '"]' : '');
    document.querySelectorAll(sel).forEach(function (btn) {
      var locked = !canSetAssignmentStatus(
        pageState.activeCourse,
        btn.dataset.sid,
        btn.dataset.aid,
        btn.dataset.status,
      );
      if (btn.disabled === locked) return;
      btn.disabled = locked;
      if (locked) btn.title = _STATUS_LOCKED_TITLE;
      else btn.removeAttribute('title');
    });
  }
  /* What an event on the page can have changed: one student's piece of
     work ({ aid, sid }), one piece ({ aid }), or anything (null). A click
     or key on a student's row is that student's, except on pair and group
     work, where one row writes every member. Elsewhere in a card (a
     column's fill, Set Everyone To) it is the card's; outside every card
     (a question's OK, Undo, the toolbar, Class Results) it is anything. */
  function _eventScope(e) {
    var t = e && e.target;
    var card = t && t.closest ? t.closest('.assess-card') : null;
    var main = document.getElementById('main');
    if (!card || !main || !main.contains(card)) return null;
    var row = t.closest('[data-sid], [data-student], [data-status-student]');
    var sid = row && card.contains(row) && (row.dataset.sid || row.dataset.student || row.dataset.statusStudent);
    return _gradingScope(card.id.slice(3), sid);
  }
  function _gradingScope(aid, sid) {
    var a = sid && _assessmentById(pageState.activeCourse, aid);
    return a && (!a.collaboration || a.collaboration === 'individual') ? { aid: aid, sid: sid } : { aid: aid };
  }
  // Typing in a box saves on Enter or on leaving it, so a key that is not
  // Enter there brings nothing up to date (a key was two page-wide sweeps).
  function _typingKey(e) {
    var t = e.target;
    if (e.type !== 'keyup' || e.key === 'Enter' || !t) return false;
    if (t.isContentEditable || t.tagName === 'TEXTAREA') return true;
    return (
      t.tagName === 'INPUT' && /^(text|search|number|email|url|tel|password)?$/i.test(t.getAttribute('type') || '')
    );
  }
  // After an event that may have saved a grade: the Missing | Excused locks,
  // then the Draft marks and counts to return (S1-F2), for what it touched.
  function _afterGradingEvent(e) {
    if (_typingKey(e)) return;
    var scope = _eventScope(e);
    setTimeout(function () {
      _syncStatusLocks(scope);
    }, 0);
    _returnsAfterEvent(scope);
  }
  // The Missing | Excused | Late control's buttons, in the order given.
  // html-safe: status keys and labels are constants; aid and sid are our ids
  function _graderStatusButtons(aid, sid, status, order) {
    return order
      .map(function (key) {
        var on = status === key;
        return (
          '<button type="button" class="grader-status-btn' +
          (on ? ' is-on is-' + key.toLowerCase() : '') +
          '" aria-pressed="' +
          on +
          '" data-action="toggleStudentStatus" data-aid="' +
          aid +
          '" data-sid="' +
          sid +
          '" data-status="' +
          key +
          '"' +
          _statusLockAttrs(aid, sid, key) +
          '>' +
          _GRADER_STATUS_LABELS[key] +
          '</button>'
        );
      })
      .join('<span class="grader-status-sep" aria-hidden="true"></span>');
  }

  /* One student open on the Assignments page: the dialog's grader inside
     the card, under a row with the student's name, the Missing | Excused |
     Late control, the arrow-key hint and the grade. */
  function _inlineGraderHtml(cid, a, tagObjs, st, scores) {
    var status = getAssignmentStatus(cid, st.id, a.id);
    var grade = _graderGrade(cid, a, st.id);
    return (
      '<div class="grader-inline' +
      (status === 'NS' || status === 'EXC' ? ' is-locked' : '') +
      '">' +
      '<div class="grader-inline-head">' +
      '<h4 class="grader-inline-name">' +
      esc(displayNameWithLast(st)) +
      '</h4>' +
      _printMarkHtml(cid, a.id, st.id) +
      '<div class="grader-status" role="group" aria-label="Status">' +
      _graderStatusButtons(a.id, st.id, status, isDibelsScored(a) ? ['NS', 'EXC'] : ['NS', 'EXC', 'LATE']) +
      '</div>' +
      _inlineWorkHtml(cid, a, st.id) +
      '<span class="grader-spacer"></span>' +
      '<span class="grader-hint">← → change student</span>' +
      (isDibelsScored(a)
        ? '<span class="grader-dibels-levels">' + _dibelsLevelPillsHtml(cid, a, st.id) + '</span>'
        : '<span class="grader-grade-label">Grade</span>' +
          '<span class="grader-grade' +
          (grade.tone ? ' tone-' + grade.tone : '') +
          '">' +
          esc(grade.text) +
          '</span>') +
      '</div>' +
      _graderHtml(cid, a, tagObjs, [st], scores, true) +
      _inlineReturnRowHtml(cid, a, st.id) +
      '</div>'
    );
  }

  /* ── Group work in the dialog (Group grading, shared/data.js) ──
     Pair and Group work is graded once per group: the dialog shows the
     group's name, a card of its members (each with their own Missing |
     Excused | Late and a ⋯ menu with Grade Separately), and the grading
     controls of the member the group's grade is copied from. A member
     graded separately gets their own view, as any student. ← → step group
     by group, each group followed by its members graded separately, then
     the students in no group. */
  var _GRADER_MORE_ICON =
    '<svg width="16" height="4" viewBox="0 0 16 4" aria-hidden="true"><circle cx="2" cy="2" r="1.8" fill="currentColor"/><circle cx="8" cy="2" r="1.8" fill="currentColor"/><circle cx="14" cy="2" r="1.8" fill="currentColor"/></svg>';

  // The group view for `sid` (a member still graded with their group), or
  // null: { group, label, members, linked, source } (groupGradingUnits).
  function _graderGroupView(cid, a, sid) {
    var units = _graderUnits(cid, a);
    var unit =
      units &&
      units.find(function (u) {
        return u.linked && u.linked.indexOf(sid) >= 0;
      });
    return unit ? Object.assign({ label: collabGroupLabel(unit.group) }, unit) : null;
  }

  // Group work's grading units in the class's last-name order (null on
  // other work).
  function _graderUnits(cid, a) {
    return groupGradingUnits(
      cid,
      a,
      sortStudents(getStudents(cid), 'lastName').map(function (s) {
        return s.id;
      }),
    );
  }
  // The student ids a unit stands for: a group's linked members, or one.
  function _unitIds(unit) {
    return unit.linked || [unit.sid];
  }
  function _graderUnitIndex(units, sid) {
    for (var i = 0; i < units.length; i++) if (_unitIds(units[i]).indexOf(sid) >= 0) return i;
    return -1;
  }
  // The dialog's steps: from the gradebook, only the units with a row on
  // screen, in the rows' order; otherwise every unit.
  function _graderSteps(cid, a) {
    var units = _graderUnits(cid, a);
    var rows = pageState._grader && pageState._grader.rowOrder;
    if (!units || !rows) return units;
    var at = function (unit) {
      return _unitIds(unit).reduce(function (best, id) {
        var i = rows.indexOf(id);
        return i >= 0 && (best < 0 || i < best) ? i : best;
      }, -1);
    };
    return units
      .filter(function (u) {
        return at(u) >= 0;
      })
      .sort(function (x, y) {
        return at(x) - at(y);
      });
  }

  /* ── The grader's queue (I3, docs/plans/inbox-redesign-plan.md) ──
     The Inbox opens the grader with `queue`, [{ aid, studentIds }] in the
     order its stacks are shown. On the last step of a piece Next names the
     next piece and carries on into it, in the same dialog; Previous on the
     first step goes back to the last step of the one before. After the
     last piece Next reads Finish and the dialog shows All Caught Up. With
     no queue none of this draws and nothing here runs. */
  function _graderQueueOf(queue, aid) {
    if (!queue || !queue.length) return null;
    var out = queue
      .filter(function (q) {
        return q && q.aid;
      })
      .map(function (q) {
        return { aid: q.aid, studentIds: (q.studentIds || []).slice() };
      });
    return out.some(function (q) {
      return q.aid === aid;
    })
      ? out
      : null;
  }

  // A piece the queue can carry into: it is in the class and has someone in its list.
  function _graderQueueTarget(dir) {
    var cid = pageState.activeCourse;
    var roster = getStudents(cid).map(function (s) {
      return s.id;
    });
    for (var i = pageState._grader.qi + dir; i >= 0 && i < pageState._grader.queue.length; i += dir) {
      var q = pageState._grader.queue[i];
      if (!_assessmentById(cid, q.aid)) continue;
      var anyone = q.studentIds.some(function (id) {
        return roster.indexOf(id) >= 0;
      });
      if (anyone) return i;
    }
    return -1;
  }

  /* True when a step in `dir` has nowhere to go in this piece: the last (or
     first) student, group or one Show lists. */
  function _graderEdge(dir) {
    var cid = pageState.activeCourse;
    var a = _assessmentById(cid, pageState._grader.aid);
    if (!a) return false;
    if (_graderShowOn() && _graderShowWanted(cid, a)) return !_nextShownStop(cid, a, dir);
    var steps = _graderSteps(cid, a);
    if (steps) {
      var u = _graderUnitIndex(steps, pageState.focusStudentId);
      return u >= 0 && (dir > 0 ? u >= steps.length - 1 : u <= 0);
    }
    var i = pageState._grader.studentIds.indexOf(pageState.focusStudentId);
    return i >= 0 && (dir > 0 ? i >= pageState._grader.studentIds.length - 1 : i <= 0);
  }

  // ← → at an edge of a piece in a queue. True when it was used.
  function _graderQueueStep(dir) {
    if (!pageState._grader.queue || !_graderEdge(dir)) return false;
    var to = _graderQueueTarget(dir);
    if (to >= 0) _graderSwitchPiece(to, dir > 0 ? 'first' : 'last');
    else if (dir > 0) _graderShowCaughtUp();
    else return false;
    return true;
  }

  /* The dialog on another piece of the queue, as if it had been opened on
     it: its students, its work pane and Show as they began. The dialog, its
     listeners and onClose stay. `which` is the student it lands on: the
     first one Show lists, or the last. */
  function _graderSwitchPiece(qi, which) {
    var cid = pageState.activeCourse;
    var q = pageState._grader.queue[qi];
    // A field being typed in saves on blur, so finish it first.
    var active = document.activeElement;
    if (active && pageState._grader.overlay.contains(active) && active.blur) active.blur();
    if (window.MarkUp && MarkUp.isOpen()) MarkUp.close();
    var roster = getStudents(cid).map(function (s) {
      return s.id;
    });
    var ids = q.studentIds.filter(function (id) {
      return roster.indexOf(id) >= 0;
    });
    _graderForgetDrawn();
    pageState._grader.aid = q.aid;
    pageState._grader.qi = qi;
    pageState._grader.studentIds = ids;
    if (pageState._grader.rowOrder) pageState._grader.rowOrder = ids.slice();
    pageState._grader.menuSid = null;
    pageState._grader.show = pageState._grader.queueShow;
    pageState._grader.work = { page: 0, fit: _workFitSaved(), turns: {}, focus: false, pics: {} };
    pageState._grader.reflectDrafts = {};
    pageState._grader.reflectBusy = null;
    pageState._grader.reflectMsg = null;
    pageState._grader.revisionMsg = null;
    pageState._grader.source = null;
    // Drawn from the start, as a piece opened new is.
    pageState._grader.workShell = undefined;
    pageState.openAssessIds = new Set([q.aid]);
    pageState._commentPopoverState = null;
    CritComment.drop();
    pageState._kbFocusEl = null;
    pageState._statusDebounce = {};
    var a = _assessmentById(cid, q.aid);
    var stops = _graderStops(cid, a);
    var listed =
      _graderShowOn() && _graderShowWanted(cid, a)
        ? stops.filter(function (s) {
            return _stopShown(cid, q.aid, s, pageState._grader.show);
          })
        : [];
    var pool = listed.length ? listed : stops;
    var stop = which === 'last' ? pool[pool.length - 1] : pool[0];
    pageState.focusStudentId = stop.focus;
    _graderToTop();
    render();
    if (!pageState._grader) return;
    var again = pageState._grader.overlay.querySelector('[data-grader="next"]:not(:disabled)');
    if (again) again.focus({ preventScroll: true });
    else pageState._grader.overlay.querySelector('.grader-dialog').focus({ preventScroll: true });
    if (which === 'first') _focusGraderPoints(q.aid);
  }

  /* Next and Previous in a queue: on the last step of a piece Next names the
     next piece (or reads Finish after the last); on the first step Previous
     is on when a piece comes before. Called after the dialog's chrome is
     drawn, so it has the last word on both buttons. */
  function _graderApplyQueue(dialog, cid, a, view) {
    if (!pageState._grader.queue) return;
    if (pageState._grader.caughtUp && !dialog.querySelector('.grader-caught-up')) pageState._grader.caughtUp = false;
    var next = dialog.querySelector('[data-grader="next"]');
    var prev = dialog.querySelector('[data-grader="prev"]');
    if (!next || !prev) return;
    if (_graderEdge(1)) {
      var to = _graderQueueTarget(1);
      var following = to >= 0 ? _assessmentById(cid, pageState._grader.queue[to].aid) : null;
      var title = following ? following.title || 'Assessment' : '';
      var label = following ? 'Next: ' + title + ' →' : 'Finish';
      next.disabled = false;
      if (next.dataset.queueLabel !== label) {
        next.dataset.queueLabel = label;
        next.classList.add('is-queue');
        // html-safe: the title goes through esc
        next.innerHTML = following
          ? '<span class="grader-next-pre">Next: </span><span class="grader-next-title">' +
            esc(title) +
            '</span><span class="grader-next-arrow"> →</span>'
          : '<span class="grader-next-pre">Finish</span>';
      }
      next.setAttribute('aria-label', label);
      next.title = label;
    } else if (next.classList.contains('is-queue')) {
      next.classList.remove('is-queue');
      delete next.dataset.queueLabel;
      next.removeAttribute('title');
      // html-safe: a fixed icon
      next.innerHTML = _GRADER_CHEVRON_RIGHT;
      next.setAttribute('aria-label', view ? 'Next' : 'Next student');
    }
    var back = _graderEdge(-1) ? _graderQueueTarget(-1) : -1;
    if (back >= 0) {
      var before = _assessmentById(cid, pageState._grader.queue[back].aid);
      prev.disabled = false;
      prev.title = 'Previous: ' + (before.title || 'Assessment');
      prev.dataset.queueBack = '1';
    } else if (prev.dataset.queueBack) {
      delete prev.dataset.queueBack;
      prev.removeAttribute('title');
    }
  }

  // The queue's pieces with grades waiting, in order: [{ aid, title, sids }], whole class.
  function _graderQueueWaiting(cid) {
    if (!_holdsGrades(cid)) return [];
    var roster = getStudents(cid).map(function (s) {
      return s.id;
    });
    var seen = {};
    var out = [];
    pageState._grader.queue.forEach(function (q) {
      var a = _assessmentById(cid, q.aid);
      if (!a || seen[q.aid]) return;
      seen[q.aid] = true;
      var sids = GraderWork.draftsReturned(cid, q.aid, roster);
      if (sids.length) out.push({ aid: q.aid, title: a.title || 'Assessment', sids: sids });
    });
    return out;
  }

  /* All Caught Up, over the dialog after the last step of the last piece:
     what is waiting to be returned, piece by piece, then Return N Graded
     and Not Yet; in a class that holds no grades, or with nothing waiting,
     Done. */
  // html-safe: counts and fixed words; titles go through esc
  function _graderCaughtUpHtml(items) {
    var n = items.reduce(function (sum, i) {
      return sum + i.sids.length;
    }, 0);
    return (
      '<h2 class="grader-caught-up-title" id="grader-caught-up-title">All Caught Up</h2>' +
      (items.length
        ? '<ul class="grader-caught-up-list">' +
          items
            .map(function (i) {
              return (
                '<li><span class="grader-caught-up-name">' +
                esc(i.title) +
                '</span><span class="grader-caught-up-n">' +
                i.sids.length +
                ' graded</span></li>'
              );
            })
            .join('') +
          '</ul>' +
          '<div class="grader-caught-up-actions">' +
          '<button type="button" class="btn btn-primary" data-grader="caught-return">' +
          esc(GradeState.returnNGraded(n)) +
          '</button>' +
          '<button type="button" class="btn btn-ghost" data-grader="caught-close">Not Yet</button></div>'
        : '<div class="grader-caught-up-actions">' +
          '<button type="button" class="btn btn-primary" data-grader="caught-close">Done</button></div>')
    );
  }

  function _graderShowCaughtUp() {
    var cid = pageState.activeCourse;
    var dialog = pageState._grader.overlay.querySelector('.grader-dialog');
    if (!dialog) return;
    var active = document.activeElement;
    if (active && pageState._grader.overlay.contains(active) && active.blur) active.blur();
    _graderHideCaughtUp();
    var panel = document.createElement('section');
    panel.className = 'grader-caught-up';
    panel.setAttribute('aria-labelledby', 'grader-caught-up-title');
    // html-safe: built by _graderCaughtUpHtml
    panel.innerHTML = _graderCaughtUpHtml(_graderQueueWaiting(cid));
    Array.prototype.forEach.call(dialog.children, function (el) {
      el.setAttribute('inert', '');
    });
    dialog.appendChild(panel);
    pageState._grader.caughtUp = true;
    var first = panel.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }

  function _graderHideCaughtUp() {
    if (!pageState._grader) return;
    var dialog = pageState._grader.overlay.querySelector('.grader-dialog');
    if (!dialog) return;
    var panel = dialog.querySelector('.grader-caught-up');
    if (panel) panel.remove();
    Array.prototype.forEach.call(dialog.children, function (el) {
      el.removeAttribute('inert');
    });
    var wasUp = pageState._grader.caughtUp;
    pageState._grader.caughtUp = false;
    if (wasUp) {
      var back = dialog.querySelector('[data-grader="next"]') || dialog;
      back.focus({ preventScroll: true });
    }
  }

  // Return N Graded on the panel: asks first, naming everyone, then returns each piece's drafts and closes.
  function _graderCaughtReturn(button) {
    if (!pageState._grader) return;
    var cid = pageState.activeCourse;
    var overlay = pageState._grader.overlay;
    var items = _graderQueueWaiting(cid);
    if (!items.length) return closeGrader();
    _askReturnPieces(cid, items, button, function () {
      if (!pageState._grader || pageState._grader.overlay !== overlay) return;
      items.forEach(function (i) {
        _returnDrafts(cid, i.aid, i.sids);
      });
      closeGrader();
    });
  }

  /* One question for the drafts waiting on several pieces: "Return 4 Grades
     Now?" and the names, once each, of everyone with a grade waiting. */
  function _askReturnPieces(cid, items, button, then) {
    var all = [];
    items.forEach(function (i) {
      all = all.concat(i.sids);
    });
    var who = all.filter(function (sid, k) {
      return all.indexOf(sid) === k;
    });
    var message = GradeState.draftsSentence(cid, who);
    if (who.length !== all.length)
      message = message.replace(/^\d+ drafts?/, all.length + ' drafts').replace(' it yet.', ' them yet.');
    if (button && button.focus) button.focus({ preventScroll: true });
    showConfirm(GradeState.returnQuestion(all.length), message, GradeState.returnNGraded(all.length), 'primary', then);
  }

  /* The Dashboard's Return N Graded (I3): one question naming everyone with
     a grade waiting on these pieces, then each piece's drafts are returned
     and `then` is called. It reads nothing from the page shown: every call
     takes the class. Nothing happens, and `then` is not called, in a class
     that holds no grades or with nothing waiting. */
  function askReturn(cid, aids, button, then) {
    if (!_holdsGrades(cid)) return;
    var roster = getStudents(cid).map(function (s) {
      return s.id;
    });
    var items = [];
    (aids || []).forEach(function (aid) {
      var have = items.some(function (i) {
        return i.aid === aid;
      });
      if (have) return;
      var sids = GraderWork.draftsReturned(cid, aid, roster);
      if (sids.length) items.push({ aid: aid, sids: sids });
    });
    if (!items.length) return;
    _askReturnPieces(cid, items, button, function () {
      items.forEach(function (i) {
        _returnDrafts(cid, i.aid, i.sids);
      });
      if (typeof then === 'function') then();
    });
  }

  // ← → on group work. False on other work, which steps student by student.
  function _graderStepGroup(dir) {
    var cid = pageState.activeCourse;
    var a = _assessmentById(cid, pageState._grader.aid);
    var units = _graderSteps(cid, a);
    if (!units) return false;
    var next = units[_graderUnitIndex(units, pageState.focusStudentId) + dir];
    if (_graderUnitIndex(units, pageState.focusStudentId) < 0 || !next) return true;
    pageState._grader.menuSid = null;
    pageState.focusStudentId = next.source || next.sid;
    render();
    return true;
  }

  // The members card's buttons: the ⋯ menu, Grade Separately, Back to
  // Group Grade and a separated member's name, which opens their view.
  function _graderGroupAction(what, sid) {
    var cid = pageState.activeCourse;
    var aid = pageState._grader.aid;
    var a = _assessmentById(cid, aid);
    if (!a || !sid) return;
    if (what === 'member-menu') {
      pageState._grader.menuSid = pageState._grader.menuSid === sid ? null : sid;
      _refreshGraderChrome();
      var item =
        pageState._grader.menuSid &&
        pageState._grader.overlay.querySelector('.grader-member-menu:not([hidden]) button');
      if (item) item.focus();
    } else if (what === 'separate') {
      pageState._grader.menuSid = null;
      Grader.gradeSeparately(cid, aid, sid);
      // The group stays open; it draws from another member now if it drew
      // from this one.
      if (pageState.focusStudentId === sid) {
        var stillLinked = (getCollabGroupOf(a, sid) || { members: [] }).members.find(function (m) {
          return !isGradedSeparately(a, m);
        });
        var view = stillLinked && _graderGroupView(cid, a, stillLinked);
        if (view) pageState.focusStudentId = view.source;
      }
      refreshSidebarGrades();
      render();
    } else if (what === 'rejoin') {
      _confirmBackToGroupGrade(cid, a, sid);
    } else if (what === 'open-member') {
      pageState._grader.menuSid = null;
      pageState.focusStudentId = sid;
      render();
    } else if (what === 'change-one') {
      // Change One Student (S12-F2): they keep the group's grade as their
      // own from here, and their grader opens to change it.
      pageState._grader.menuSid = null;
      if (!isGradedSeparately(a, sid)) Grader.gradeSeparately(cid, aid, sid);
      pageState.focusStudentId = sid;
      refreshSidebarGrades();
      render();
    }
  }

  function _confirmBackToGroupGrade(cid, a, sid) {
    var st = getStudents(cid).find(function (x) {
      return x.id === sid;
    });
    var group = getCollabGroupOf(a, sid);
    if (!st || !group) return;
    var done = function () {
      Grader.backToGroupGrade(cid, a.id, sid);
      refreshSidebarGrades();
      render();
    };
    // Nobody to copy from: nothing is replaced, so nothing to ask.
    if (!backToGroupGradeSource(cid, a.id, sid)) return done();
    var first = displayNameFirst(st);
    showConfirm(
      'Back to Group Grade?',
      first + '’s own levels, comments and Overall Comment will be replaced by ' + collabGroupLabel(group) + '’s.',
      'Back to Group Grade',
      'primary',
      done,
    );
  }

  /* Students in This Group (S12-F2): what is different for a member
     graded on their own, criterion by criterion, against the group's
     grade ("Roles on the Manor: Emerging · changed for Leo"). Levels are
     named through scoreLevelText. */
  function _memberChanges(cid, a, sid, source) {
    if (!source || source === sid) return [];
    var levelsOf = function (id) {
      var out = {};
      (getScores(cid)[id] || []).forEach(function (e) {
        if (e && e.assessmentId === a.id && e.tagId && e.tagId !== 'overall') out[e.tagId] = e;
      });
      return out;
    };
    var mine = levelsOf(sid);
    var theirs = levelsOf(source);
    var names = {};
    var rubric = a.rubricId ? getRubricById(cid, a.rubricId) : null;
    ((rubric && rubric.criteria) || []).forEach(function (c) {
      rubricCriterionScoreKeys(c).forEach(function (k) {
        names[k] = c.name || c.title || '';
      });
    });
    var first = displayNameFirst(_workStudent(cid, sid) || {});
    var out = [];
    Object.keys(mine).forEach(function (k) {
      var m = mine[k];
      var t = theirs[k];
      if (t && t.score === m.score && (t.mod || 0) === (m.mod || 0)) return;
      var name = names[k] || (getTagById(cid, k) || {}).label || '';
      var level = scoreLevelText(m.score, m.mod);
      if (!name || !level) return;
      out.push(name + ': ' + level + ' · changed for ' + first);
    });
    return out;
  }
  var _COUNT_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six'];

  /* One member as a row of Students in This Group (TGroupGrade): the
     name, "Same as group" (or what was changed for them) at the right,
     their own Missing | Excused | Late, and ⋯ (Grade Separately) or Back
     to Group Grade. */
  // html-safe: names go through esc(); ids are ours; labels are constants
  function _graderMemberHtml(cid, a, st, menuSid, source) {
    var sid = st.id;
    var name = esc(displayNameWithLast(st));
    var status = getAssignmentStatus(cid, sid, a.id);
    var statusHtml =
      '<div class="grader-status" role="group" aria-label="Status for ' +
      name +
      '">' +
      _graderStatusButtons(a.id, sid, status, ['NS', 'EXC', 'LATE']) +
      '</div>';
    if (isGradedSeparately(a, sid)) {
      var grade = _graderGrade(cid, a, sid);
      var changes = _memberChanges(cid, a, sid, source);
      return (
        '<div class="grader-member is-separate">' +
        '<button type="button" class="grader-member-name is-link" data-grader="open-member" data-sid="' +
        sid +
        '">' +
        name +
        '</button>' +
        '<div class="grader-member-separate">Graded Separately<span class="grader-grade' +
        (grade.tone ? ' tone-' + grade.tone : '') +
        '">' +
        esc(grade.text) +
        '</span></div>' +
        statusHtml +
        '<button type="button" class="grader-member-back" data-grader="rejoin" data-sid="' +
        sid +
        '">Back to Group Grade</button>' +
        (changes.length
          ? '<div class="grader-member-changes">' +
            changes
              .map(function (line) {
                return '<p class="grader-member-same is-changed">' + esc(line) + '</p>';
              })
              .join('') +
            '</div>'
          : '') +
        '</div>'
      );
    }
    var open = menuSid === sid;
    return (
      '<div class="grader-member">' +
      '<span class="grader-member-name">' +
      name +
      '</span>' +
      '<p class="grader-member-same">Same as group</p>' +
      statusHtml +
      '<button type="button" class="grader-member-more" data-grader="member-menu" data-sid="' +
      sid +
      '" aria-label="More for ' +
      name +
      '" aria-haspopup="menu" aria-expanded="' +
      open +
      '">' +
      _GRADER_MORE_ICON +
      '</button>' +
      '<div class="grader-member-menu" role="menu"' +
      (open ? '' : ' hidden') +
      '><button type="button" role="menuitem" data-grader="separate" data-sid="' +
      sid +
      '">Grade Separately</button></div>' +
      '</div>'
    );
  }

  /* Students in This Group sits after the criteria and before the Overall
     Comment, as on the board; with no group it goes back above the
     scoring, where _drawGraderPanel keeps it while the scoring is redrawn. */
  function _placeGroupMembers(panel, card, inGroup) {
    var body = panel.querySelector('.grader-body');
    if (!body) return;
    var overall = inGroup ? body.querySelector('.grdt-overall') : null;
    if (overall) {
      if (card.nextElementSibling !== overall) overall.parentNode.insertBefore(card, overall);
    } else if (inGroup) {
      if (card.previousElementSibling !== body) body.parentNode.insertBefore(card, body.nextSibling);
    } else if (card.nextElementSibling !== body) {
      body.parentNode.insertBefore(card, body);
    }
  }

  // The members card (group view) and the Graded Separately From line (a
  // member graded separately), redrawn only when they change.
  function _refreshGroupChrome(dialog, cid, a, sid, view) {
    var card = dialog.querySelector('.grader-members');
    var html = '';
    if (view) {
      var byId = {};
      getStudents(cid).forEach(function (s) {
        byId[s.id] = s;
      });
      var n = view.members.length;
      // The board's Students in This Group (TGroupGrade), with or without
      // the work beside the scoring: one grade for all, and Change One
      // Student (Grade Separately, then open them).
      html =
        '<h2 class="grader-members-title" id="grader-members-title">' +
        (view.group.kind === 'pair' ? 'Students in This Pair' : 'Students in This Group') +
        '</h2>' +
        '<p class="grader-members-hint">' +
        esc(
          (n === 2 ? 'One grade for both' : 'One grade for all ' + (_COUNT_WORDS[n] || n)) +
            '. Change one student only when their part was different.',
        ) +
        '</p>' +
        '<div class="grader-members-grid">' +
        view.members
          .map(function (m) {
            return _graderMemberHtml(cid, a, byId[m], pageState._grader.menuSid, view.source);
          })
          .join('') +
        '</div>';
      var changeable = view.linked.filter(function (m) {
        return byId[m];
      });
      var openChange = pageState._grader.menuSid === 'change-one';
      html +=
        '<div class="grader-change-one">' +
        '<button type="button" class="grader-change-one-btn" data-grader="member-menu" data-sid="change-one" aria-haspopup="menu" aria-expanded="' +
        openChange +
        '"' +
        (changeable.length > 1 ? '' : ' disabled') +
        '>Change One Student</button>' +
        '<div class="grader-member-menu" role="menu"' +
        (openChange ? '' : ' hidden') +
        '>' +
        changeable
          .map(function (m) {
            return (
              '<button type="button" role="menuitem" data-grader="change-one" data-sid="' +
              m +
              '">' +
              esc(displayNameWithLast(byId[m])) +
              '</button>'
            );
          })
          .join('') +
        '</div></div>';
    }
    if (pageState._grader.membersHtml !== html) {
      // html-safe: built by _graderMemberHtml, names escaped there
      card.innerHTML = html;
      pageState._grader.membersHtml = html;
    }
    card.hidden = !view;
    _placeGroupMembers(dialog, card, !!view);
    var line = dialog.querySelector('.grader-separate-line');
    var group = !view && isGradedSeparately(a, sid) ? getCollabGroupOf(a, sid) : null;
    var lineHtml = group
      ? esc('Graded Separately From ' + collabGroupLabel(group)) +
        '<button type="button" class="grader-member-back" data-grader="rejoin" data-sid="' +
        sid +
        '">Back to Group Grade</button>'
      : '';
    if (pageState._grader.lineHtml !== lineHtml) {
      // html-safe: the label goes through esc(); sid is our id
      line.innerHTML = lineHtml;
      pageState._grader.lineHtml = lineHtml;
    }
    line.hidden = !group;
  }

  /* The parts of the dialog that change with every click: the status
     control, the Note for the Report and the grade. */
  /* The same buttons with new states are updated where they are: a score
     typed and then Late clicked locks Missing and Excused as the box loses
     focus, mid-click, and a Late button swapped in then can lose the click.
     False when the buttons themselves differ. */
  function _patchStatusButtons(box, html) {
    var tpl = document.createElement('template');
    // html-safe: html is built by _graderStatusButtons
    tpl.innerHTML = html;
    var fresh = tpl.content.querySelectorAll('.grader-status-btn');
    var now = box.querySelectorAll('.grader-status-btn');
    if (!now.length || fresh.length !== now.length) return false;
    for (var i = 0; i < now.length; i++) {
      if (
        now[i].dataset.status !== fresh[i].dataset.status ||
        now[i].dataset.sid !== fresh[i].dataset.sid ||
        now[i].dataset.aid !== fresh[i].dataset.aid
      )
        return false;
    }
    now.forEach(function (btn, j) {
      var f = fresh[j];
      btn.className = f.className;
      btn.setAttribute('aria-pressed', f.getAttribute('aria-pressed'));
      btn.disabled = f.disabled;
      if (f.hasAttribute('title')) btn.title = f.title;
      else btn.removeAttribute('title');
    });
    return true;
  }
  function _refreshGraderChrome() {
    if (!pageState._grader) return;
    var cid = pageState.activeCourse;
    var sid = pageState.focusStudentId;
    var a = getAssessments(cid).find(function (x) {
      return x.id === pageState._grader.aid;
    });
    var dialog = pageState._grader.overlay.querySelector('.grader-dialog');
    if (!a || !sid || !dialog) return;
    var view = _graderGroupView(cid, a, sid);
    // The member the group's grade comes from changed (Missing, Excused or
    // Grade Separately): draw the group again from the new one.
    if ((view ? view.source : null) !== (pageState._grader.source || null)) return render();
    _refreshGraderPanel(_graderPart(dialog, 'panel'), cid, a, sid, view);
    _refreshGraderHead(_graderPart(dialog, 'head'), cid, a, sid, view);
    var foot = _graderPart(dialog, 'foot');
    // Points work's box takes Return to the next student, so the hint says
    // so; ← → step while nothing new is typed in it (_graderCardKey).
    var returnStep = isPointsScored(a) && !isCompletionScored(a) ? 'Return next student \u00B7 ' : '';
    foot.querySelector('.grader-hint').textContent = view
      ? returnStep + '\u2190 \u2192 change group \u00B7 Esc closes'
      : returnStep + '\u2190 \u2192 change student \u00B7 Esc closes';
    _refreshGraderReturn(dialog, cid, a, sid, view);
    // A revision's card and its "Was …" lines (S11-F3), on one student's own piece.
    var own = view ? null : _workStudent(cid, sid);
    if (own) _refreshGraderRevision(dialog, cid, a, own);
    _refreshGraderWas(dialog, cid, a, own ? sid : null);
    if (pageState._grader.workShell) {
      _refreshGraderWorkLine(dialog, cid, a, sid);
      _graderShortLevels(dialog);
    }
    // To Return, Returned and All, and Return N Graded (S1-F2). It draws
    // the dialog again itself when what Show lists has run out.
    if (_refreshGraderShow(dialog, cid, a)) return;
    _graderApplyQueue(dialog, cid, a, view);
    var grade = _graderGrade(cid, a, sid);
    // The foot's: a member graded separately has a grade of her own in the
    // members card, above it.
    var pill = foot.querySelector('.grader-grade');
    pill.textContent = grade.text;
    pill.className = 'grader-grade' + (grade.tone ? ' tone-' + grade.tone : '');
    // A DIBELS benchmark has no grade: its footer shows the ORF and Maze levels.
    var dibels = isDibelsScored(a);
    foot.querySelector('.grader-grade-label').hidden = dibels;
    pill.hidden = dibels;
    var levels = foot.querySelector('.grader-dibels-levels');
    if (dibels) {
      if (!levels) {
        levels = document.createElement('span');
        levels.className = 'grader-dibels-levels';
        foot.appendChild(levels);
      }
      levels.innerHTML = _dibelsLevelPillsHtml(cid, a, sid);
    } else if (levels) levels.remove();
  }

  /* ── Work to grade on the Assignments page (S6-F4) ───────────
     In a class whose student page and Send Work are on: the Show bar
     (All | Submitted | To Grade 9 | Not In, assign-show.js) on the toolbar, "6 to grade" on a card, Grade Submissions,
     which opens the grader dialog on the work waiting (Show on To Grade),
     and on one student's grader, what came in and Add Work. Every number is
     GraderWork.workCounts', as the gradebook's and the dashboard's are. */
  // html-safe: ids are ours; fixed words
  function _gradeSubmissionsHtml(cid, a, shownIds, tograde) {
    if (pageState.focusStudentId || !GraderWork.workOn(cid, a)) return '';
    if (!(tograde != null ? tograde : GraderWork.workCounts(cid, a.id, shownIds).tograde)) return '';
    return (
      '<button type="button" class="assess-grade-work-btn" data-action="gradeSubmissions" data-aid="' +
      a.id +
      '">Grade Submissions</button>'
    );
  }

  /* The open card's header (AssignmentsPage board): Grade Submissions
     and a ⋯ menu, so the title keeps its room. Every action the old row
     of buttons had is in the ⋯ menu: Class Results, Print, the Work Wall
     (while the piece takes work), Grade by Competencies or Rubric, Show or
     Hide Checklists, Set Everyone To (Colin, Nov 16: in the menu, not a
     button of its own on the bar), Edit Assessment, Duplicate, Copy to
     Another Class… and Delete…. One menu is open at a time; a click
     elsewhere or Esc closes it. */
  var _ARROW_RIGHT_ICON =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 8h11M9 3.5L13.5 8 9 12.5"/></svg>';
  var _SUB_CARET =
    '<svg class="assess-sub-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  var _WALL_ICON =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="2" width="5.5" height="5" rx="1"/><rect x="9" y="2" width="5.5" height="5" rx="1"/><rect x="1.5" y="9" width="5.5" height="5" rx="1"/><rect x="9" y="9" width="5.5" height="5" rx="1"/></svg>';

  // html-safe: attrs are built from our ids and fixed words; label and icon are fixed
  function _cardMenuItem(attrs, icon, label, cls) {
    return (
      '<button type="button" role="menuitem" class="assess-menu-item' +
      (cls ? ' ' + cls : '') +
      '" ' +
      attrs +
      '>' +
      (icon || '<span class="assess-menu-icon" aria-hidden="true"></span>') +
      '<span>' +
      label +
      '</span></button>'
    );
  }

  /* The ⋯ menu's Set Everyone To › while the class's levels grid shows
     (the competency or rubric grid, not one student's grader, points, a
     mark or DIBELS): a submenu of the four levels in the class's order
     (teacher/card-menu.js). Points and Complete/Incomplete keep their Set
     Unmarked To buttons above their grid. */
  // html-safe: ids are ours; level names are fixed
  function _setEveryoneMenuHtml(cid, a) {
    if (pageState.focusStudentId || isDibelsScored(a) || isCompletionScored(a) || a.scoreMode === 'points') return '';
    var rubric = a.rubricId && getRubricById(cid, a.rubricId);
    var showRubric = pageState.rubricViewStates[a.id] !== undefined ? pageState.rubricViewStates[a.id] : true;
    var action = rubric && showRubric ? 'confirmFillRubricAll' : 'confirmFillAll';
    var items = levelOrderFor(cid)
      .map(function (l) {
        return _cardMenuItem(
          'data-action="' +
            action +
            '" data-aid="' +
            a.id +
            '" data-score="' +
            l +
            '" data-label="' +
            PROF_LABELS[l] +
            '"',
          '<span class="assess-menu-dot l' + l + '" aria-hidden="true"></span>',
          PROF_LABELS[l],
        );
      })
      .join('');
    return (
      '<div class="assess-setto">' +
      '<span class="assess-menu-sep" role="separator"></span>' +
      '<button type="button" role="menuitem" class="assess-menu-item assess-sub-btn" data-action="openCardSubmenu" aria-haspopup="menu" aria-expanded="false">' +
      '<span class="assess-menu-icon" aria-hidden="true"></span><span>Set Everyone To</span>' +
      _SUB_CARET +
      '</button>' +
      '<div class="assess-menu assess-submenu" role="menu" aria-label="Set Everyone To" hidden>' +
      items +
      '</div></div>'
    );
  }

  // The ⋯ menu's Print: the same print the card always offered.
  function _cardPrintItem(cid, a) {
    var attrs = function (action, title) {
      return 'data-action="' + action + '" data-aid="' + a.id + '" title="' + title + '"';
    };
    if (a.rubricId && getRubricById(cid, a.rubricId))
      return _cardMenuItem(
        attrs('printRubrics', 'Print a graded rubric for each student'),
        LINE_ICONS.print,
        'Print Rubrics',
      );
    if (isDibelsScored(a))
      return _cardMenuItem(
        attrs('printDibels', 'Print this window’s scores for the class'),
        LINE_ICONS.print,
        'Print Class Sheet',
      );
    if (!isPointsScored(a)) {
      // No rubric of its own: a Tag Rubric, or a General Rubric when it
      // has no competencies, with the proficiency scale's wording.
      var kind = scoreTagIds(a, cid).some(function (t) {
        return !isUnlinkedTag(t);
      })
        ? 'tag'
        : 'general';
      return _cardMenuItem(
        attrs('printRubrics', 'Print a graded ' + kind + ' rubric for each student'),
        LINE_ICONS.print,
        'Print Rubrics',
      );
    }
    // Points and Complete/Incomplete: a score sheet per student.
    return _cardMenuItem(
      attrs('printRubrics', 'Print each student’s ' + (isCompletionScored(a) ? 'mark' : 'score') + ' and feedback'),
      LINE_ICONS.print,
      'Print Scores',
    );
  }

  // html-safe: ids are ours; labels and icons are fixed
  function _cardMoreMenuHtml(cid, a) {
    var aid = 'data-aid="' + a.id + '"';
    // A Draft has no grading: Assign, Print, then what any piece has (assign-draft.js).
    var html =
      (a.isDraft
        ? AssignDraft.menuItemsHtml(cid, a, _cardMenuItem)
        : _cardMenuItem(
            'data-action="classResults" data-cid="' + esc(cid) + '" ' + aid,
            _CLASS_RESULTS_ICON,
            'Class Results',
          )) + _cardPrintItem(cid, a);
    // Work Wall (S14, shared/work-wall.js): every student's work side by
    // side, only while the piece takes work.
    var workShown = !a.isDraft && !pageState.focusStudentId && GraderWork.workShown(cid, a);
    if (workShown && window.WorkWall)
      html += _cardMenuItem('data-action="openWorkWall" ' + aid, _WALL_ICON, 'Work Wall', 'assess-work-wall-btn');
    // Add Work for the Class (teacher/add-work-class.js): in every class, on
    // every piece it is offered on, never while one student is focused.
    if (!a.isDraft && !pageState.focusStudentId && window.AddWorkClass && AddWorkClass.offered(cid, a))
      html += _cardMenuItem(
        'data-action="openAddWorkClass" ' + aid,
        LINE_ICONS.plus,
        'Add Work for the Class',
        'assess-add-class-btn',
      );
    var rubric = !a.isDraft && a.rubricId && getRubricById(cid, a.rubricId);
    if (rubric) {
      var showRubric = pageState.rubricViewStates[a.id] !== undefined ? pageState.rubricViewStates[a.id] : true;
      html +=
        '<span class="assess-menu-sep" role="separator"></span>' +
        _cardMenuItem(
          'data-action="setRubricView" ' + aid + ' data-rubric="' + !showRubric + '"',
          null,
          showRubric ? 'Grade by Competencies' : 'Grade by Rubric',
        );
      if (showRubric && _isAdvancedRubric(rubric)) {
        var show = _checklistMode() === 'show';
        html += _cardMenuItem(
          'data-action="setChecklistMode" data-mode="' + (show ? 'hide' : 'show') + '"',
          null,
          show ? 'Hide Checklists' : 'Show Checklists',
        );
      } else if (showRubric && rubricStyle(rubric) === 'standard') {
        // A Standard rubric's words, beside where an Advanced one keeps its checklists (Colin, Nov 18).
        html += _cardMenuItem('data-rw="toggle"', null, RubricWords.shown() ? 'Hide Level Words' : 'Show Level Words');
      }
    }
    html +=
      (a.isDraft ? '' : _setEveryoneMenuHtml(cid, a)) +
      '<span class="assess-menu-sep" role="separator"></span>' +
      _cardMenuItem('data-action="editAssess" ' + aid, LINE_ICONS.edit, 'Edit Assessment') +
      _cardMenuItem('data-action="dupeAssess" ' + aid, LINE_ICONS.copy, 'Duplicate');
    var targets = window.AssessmentCopy ? AssessmentCopy.copyTargets(cid) : null;
    if (targets && (targets.sameCourse.length || targets.other.length))
      html += _cardMenuItem('data-action="copyAssessToClass" ' + aid, _ARROW_RIGHT_ICON, 'Copy to Another Class…');
    html +=
      (a.isDraft ? '' : AssignDraft.menuItemsHtml(cid, a, _cardMenuItem)) +
      '<span class="assess-menu-sep" role="separator"></span>' +
      _cardMenuItem('data-action="deleteAssess" ' + aid, LINE_ICONS.trash, 'Delete…', 'is-delete');
    return (
      '<div class="assess-menu-wrap assess-more">' +
      '<button type="button" class="assess-more-btn" data-action="toggleCardMenu" aria-haspopup="menu" aria-expanded="false" aria-label="More for ' +
      esc(a.title || 'this assessment') +
      '">' +
      _GRADER_MORE_ICON +
      '</button>' +
      '<div class="assess-menu" role="menu" aria-label="More" hidden>' +
      html +
      '</div></div>'
    );
  }

  /* Copy to Another Class…: the edit form, at its Classes row (the copy is
     made when the form is saved, as from the form itself). */
  function copyAssessToClass(aid) {
    editAssess(aid);
    var field = document.getElementById('af-copy-field');
    if (!field) return;
    field.scrollIntoView({ block: 'center' });
    var chip = field.querySelector('button.af-copy-chip:not([disabled])');
    if (chip) chip.focus({ preventScroll: true });
  }

  /* One student's grader on the page: what came in ("Submitted Oct 30 ·
     2 photos", "Not In · 7 days late"), Same photo as, and the work icon
     (See the Work, or + to attach work when nothing is in). */
  // html-safe: names go through esc; ids are ours
  function _inlineWorkHtml(cid, a, sid) {
    if (!GraderWork.workShown(cid, a)) return '';
    var sub = _workSubOf(cid, sid, a.id);
    var st = _workStudent(cid, sid);
    var html = '<span class="grader-inline-work">' + esc(_workLineText(cid, a, sid, sub)) + '</span>';
    GraderWork.samePhotoAs(cid, a.id, sid).forEach(function (other) {
      var o = _workStudent(cid, other);
      if (o)
        html +=
          '<button type="button" class="grader-work-same" data-action="gradeSubmissions" data-aid="' +
          a.id +
          '" data-sid="' +
          other +
          '">' +
          esc('Same photo as ' + _workShortName(o)) +
          '</button>';
    });
    if (st) html += _workIconHtml(cid, a.id, st, sub);
    return html;
  }

  /* The work icon on a student's row (Colin, Nov 13: an icon in place of
     the words). Work in: See the Work, the page icon, which opens the
     grader on their pages; pointing at it still shows the glance
     (shared/work-wall.js, which finds it by .rsg-see-work). Nothing in: +,
     Attach Work, a menu of Image or PDF… (the grader's Add Work, from the
     row) and, where links can be kept, Link…. What is attached shows as
     the teacher's added work, and the + becomes See the Work. */
  var _attachBusy = {}; // 'aid|sid' → true while the row's + adds files

  // html-safe: ids are ours (and go through esc); the name goes through esc; icons and labels are fixed
  // known: the student's work when the caller has looked it up already
  // (null for none), so a row's work is read once: the speed guard counts it.
  function _workIconHtml(cid, aid, st, known) {
    if (!st || !window.GraderWork) return '';
    var ids = ' data-cid="' + esc(cid) + '" data-aid="' + esc(aid) + '" data-sid="' + esc(st.id) + '"';
    if (window.WorkWall) {
      // See the Work: WorkWall draws it (and wires the glance), as an icon;
      // '' when the piece shows no work, null when none is in.
      var see = WorkWall.seeWorkHtml(cid, aid, st.id, LINE_ICONS.work, known === undefined ? undefined : !!known);
      if (see) return see;
      if (see === '') return '';
    } else {
      var a = _assessmentById(cid, aid);
      if (!a || !GraderWork.workShown(cid, a)) return '';
      if (known !== undefined ? known : _workSubOf(cid, st.id, aid))
        return (
          '<button type="button" class="rsg-work-btn rsg-see-work" data-stop-prop="true" data-action="gradeSubmissions"' +
          ids +
          ' aria-label="See the Work" title="See the Work">' +
          LINE_ICONS.work +
          '</button>'
        );
    }
    var label = 'Attach Work for ' + displayNameFirst(st);
    if (_attachBusy[aid + '|' + st.id])
      return (
        '<button type="button" class="rsg-work-btn rsg-attach-btn is-busy" disabled aria-label="' +
        esc('Adding work for ' + displayNameFirst(st)) +
        '"><span class="rsg-attach-spin" aria-hidden="true"></span></button>'
      );
    // The menu and its file picker are made when the + is first clicked
    // (_attachMenuOpen): a class's grid has a + on most rows.
    return (
      '<div class="assess-menu-wrap rsg-attach">' +
      '<button type="button" class="rsg-work-btn rsg-attach-btn" data-stop-prop="true" data-action="attachWorkMenu" aria-haspopup="menu" aria-expanded="false"' +
      ids +
      ' aria-label="' +
      esc(label) +
      '" title="' +
      esc(label) +
      '">' +
      LINE_ICONS.plus +
      '</button></div>'
    );
  }

  /* The + menu for one row, made the first time it opens: Image or PDF…
     and, where links can be kept, Link…, with the hidden file picker. */
  // html-safe: ids are ours (and go through esc); the label goes through esc; icons and words are fixed
  function _attachMenuHtml(cid, aid, sid, label) {
    var ids = ' data-cid="' + esc(cid) + '" data-aid="' + esc(aid) + '" data-sid="' + esc(sid) + '"';
    var item = function (action, icon, text) {
      return (
        '<button type="button" role="menuitem" class="assess-menu-item" data-stop-prop="true" data-action="' +
        action +
        '"' +
        ids +
        '>' +
        icon +
        '<span>' +
        text +
        '</span></button>'
      );
    };
    return (
      '<div class="assess-menu rsg-attach-menu" role="menu" aria-label="' +
      esc(label) +
      '" hidden>' +
      item('attachWorkFiles', LINE_ICONS.image, 'Image or PDF…') +
      (typeof studentWorkLinksOffered === 'function' && studentWorkLinksOffered(cid)
        ? item('attachWorkLink', LINE_ICONS.link, 'Link…')
        : '') +
      '</div>' +
      '<input type="file" class="rsg-attach-file" multiple accept="image/*,.heic,.heif,application/pdf" hidden tabindex="-1" aria-hidden="true" data-action-change="attachWorkFile"' +
      ids +
      '>'
    );
  }
  function _attachMenuOpen(btn) {
    var wrap = btn.closest('.rsg-attach');
    if (!wrap) return;
    if (!wrap.querySelector('.rsg-attach-menu')) {
      var cid = btn.getAttribute('data-cid');
      var aid = btn.getAttribute('data-aid');
      var sid = btn.getAttribute('data-sid');
      // html-safe: _attachMenuHtml escapes its ids and label; the rest is fixed
      wrap.insertAdjacentHTML('beforeend', _attachMenuHtml(cid, aid, sid, btn.getAttribute('aria-label') || ''));
    }
    CardMenu.toggle(btn);
  }

  // The row's work icon for `sid`, once the page is drawn again.
  function _focusWorkIcon(aid, sid) {
    var sel = '.rsg-work-btn[data-aid="' + aid + '"][data-sid="' + sid + '"]';
    var btn = null;
    try {
      btn = document.querySelector(sel);
    } catch (e) {
      btn = null;
    }
    if (btn && !btn.disabled) btn.focus({ preventScroll: true });
  }

  // A file the row's + couldn't use, or an answer that isn't "added": said once, in a toast.
  function _attachSay(text) {
    if (!text || typeof showSyncToast !== 'function') return;
    try {
      showSyncToast(text, 'info');
    } catch (e) {
      /* a toast is only a courtesy */
    }
  }

  // Image or PDF…: the files go in as the grader's Add Work puts them (shrunk, in order).
  function _attachWorkFiles(input) {
    var files = Array.prototype.slice.call(input.files || []);
    input.value = '';
    var cid = pageState.activeCourse;
    var aid = input.getAttribute('data-aid');
    var sid = input.getAttribute('data-sid');
    var key = aid + '|' + sid;
    if (!files.length || !window.PhotoShrink || !cid || !aid || !sid || _attachBusy[key]) return;
    _attachBusy[key] = true;
    render();
    AddWorkFiles.prepare(files)
      .then(function (got) {
        if (got.said || !got.pages.length) return { result: 'refused', said: got.said };
        return addStudentWorkPages(cid, sid, aid, got.pages, { mode: 'new' });
      })
      .then(null, function () {
        return { result: 'store_failed' };
      })
      .then(function (res) {
        delete _attachBusy[key];
        if (res.result !== 'sent') _attachSay(res.said || AddWorkFiles.answer(res));
        if (pageState.activeCourse !== cid) return;
        render();
        if (!document.activeElement || document.activeElement === document.body) _focusWorkIcon(aid, sid);
      });
  }

  /* Link…: a small form under the +, a web address and an optional name,
     checked as the assessment form's links are (assessmentLinkCheck). */
  // html-safe: the name goes through esc; ids are ours (and go through esc); labels are fixed
  function _attachLinkHtml(cid, aid, sid) {
    var st = _workStudent(cid, sid);
    return (
      '<div class="rsg-attach-link" role="dialog" aria-label="' +
      esc('Attach a Link for ' + (st ? displayNameFirst(st) : 'this student')) +
      '" data-aid="' +
      esc(aid) +
      '" data-sid="' +
      esc(sid) +
      '">' +
      '<input class="af-input rsg-attach-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" aria-label="Web Address" placeholder="Paste a web address">' +
      '<input class="af-input rsg-attach-title" type="text" autocomplete="off" maxlength="200" aria-label="Name (optional)" placeholder="Name (optional)">' +
      '<p class="rsg-attach-msg" role="status" hidden></p>' +
      '<div class="rsg-attach-actions">' +
      '<button type="button" class="btn btn-ghost" data-stop-prop="true" data-action="attachLinkCancel">Cancel</button>' +
      '<button type="button" class="btn btn-primary" data-stop-prop="true" data-action="attachLinkAdd">Add Link</button>' +
      '</div></div>'
    );
  }
  function _openAttachLink(el) {
    var wrap = el && el.closest('.rsg-attach');
    if (!wrap) return;
    _closeAttachLink(false);
    CardMenu.close();
    // html-safe: built by _attachLinkHtml, which escapes the name and the ids
    wrap.insertAdjacentHTML('beforeend', _attachLinkHtml(pageState.activeCourse, el.dataset.aid, el.dataset.sid));
    var btn = wrap.querySelector('.rsg-attach-btn');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    var url = wrap.querySelector('.rsg-attach-url');
    if (url) url.focus({ preventScroll: true });
  }
  function _closeAttachLink(refocus) {
    var open = document.querySelector('.rsg-attach-link');
    if (!open) return;
    var wrap = open.closest('.rsg-attach');
    open.remove();
    var btn = wrap && wrap.querySelector('.rsg-attach-btn');
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      if (refocus) btn.focus({ preventScroll: true });
    }
  }
  function _attachLinkAdd(form) {
    if (!form || form.dataset.busy) return;
    var cid = pageState.activeCourse;
    var aid = form.dataset.aid;
    var sid = form.dataset.sid;
    var urlEl = form.querySelector('.rsg-attach-url');
    var msg = form.querySelector('.rsg-attach-msg');
    var say = function (text) {
      if (!msg) return;
      msg.textContent = text;
      msg.hidden = !text;
    };
    var check = typeof assessmentLinkCheck === 'function' ? assessmentLinkCheck(urlEl ? urlEl.value : '') : null;
    if (!check || !check.ok) {
      say(RES_LINK_WORDS[(check && check.reason) || 'not_web'] || RES_LINK_WORDS.not_web);
      if (urlEl) {
        urlEl.setAttribute('aria-invalid', 'true');
        urlEl.focus();
      }
      return;
    }
    var titleEl = form.querySelector('.rsg-attach-title');
    form.dataset.busy = '1';
    addStudentWorkLink(cid, sid, aid, check.url, titleEl ? titleEl.value : '').then(function (res) {
      delete form.dataset.busy;
      if (res.result !== 'sent') {
        say(
          res.result === 'invalid'
            ? RES_LINK_WORDS[res.reason] || RES_LINK_WORDS.not_web
            : res.result === 'on_paper'
              ? 'This was handed in on paper.'
              : res.result === 'not_found'
                ? 'This student is no longer in this class.'
                : 'Links can be added in Demo Mode only for now.',
        );
        return;
      }
      if (pageState.activeCourse !== cid) return;
      render();
      _focusWorkIcon(aid, sid);
    });
  }
  // Enter adds the link and Esc closes the form; every other key is the field's own.
  function _attachLinkKeydown(e) {
    var form = e.target && e.target.closest ? e.target.closest('.rsg-attach-link') : null;
    if (!form) return false;
    if (e.key === 'Escape') {
      e.preventDefault();
      _closeAttachLink(true);
    } else if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      _attachLinkAdd(form);
    }
    return true;
  }

  /* The grader dialog over this page, on `sid` or the first student whose
     work waits, with Show on To Grade when work waits. */
  function _openGraderOnWork(aid, sid) {
    var cid = pageState.activeCourse;
    if (pageState._grader || !aid || !_assessmentById(cid, aid)) return;
    var ids = sortStudents(getStudents(cid), 'lastName').map(function (s) {
      return s.id;
    });
    var waiting = GraderWork.workCounts(cid, aid, ids).ids.tograde;
    var to = sid || waiting[0];
    if (!to) return;
    // closeGrader puts the page back as it was before the dialog opened.
    openGrader(cid, aid, to, { show: !sid && waiting.length ? 'tograde' : 'all', overPage: true, onClose: render });
  }

  /* ── Draft and Returned (S0-F2) ───────────────────────────
     In a class whose student page is on (the build switch) and that returns
     grades When I Return Them, a row above the dialog's footer, which
     never scrolls away, says where the grade stands: Return with the Draft mark and "Saved. Not returned
     yet." while it waits, "Returned Nov 3" once it is given. A change to
     a returned grade adds the one line about what the student still sees.
     A status alone is not a grade, so Missing, Excused and Late show no
     draft, and a piece with a status and nothing in shows no row. A DIBELS
     benchmark is not returned: no row. With the switch off the row is
     never made and the dialog is as it was. Group work is returned to every member still graded with the
     group. */
  function _graderReturnIds(sid, view) {
    return view && view.linked ? view.linked.slice() : [sid];
  }

  // html-safe: fixed labels; the name and the date go through esc; `attrs` is built by the caller from our ids and an escaped title
  function _graderReturnHtml(cid, a, sid, view, attrs) {
    // The dialog's Return; one student's view on the page passes its own.
    var act = attrs || 'data-grader="return"';
    // What the row says is worked out once for both layouts (S11-T1).
    // Marks made since the last Return wait for one too (S9-F1), on a grade
    // already returned: Return gives them (Grader.returnGrades).
    // In the dialog, Return for Revision and Take Back too (S11-F1).
    var area = GraderWork.returnArea(cid, a, sid, _graderReturnIds(sid, view), { marks: true, revisions: true });
    if (!area) return '';
    // The page's own view says where a revision stands; its buttons are the dialog's.
    var own = _graderReturnOwnHtml(cid, a, sid, view, act, area);
    // In the dialog, Return & Next beside Return (Colin's review council, Nov 13):
    // where the eye is after the last level, one click or ⌘/Ctrl+Enter.
    if (!attrs && own.indexOf('class="grader-return-btn" data-grader="return">') >= 0)
      own +=
        '<button type="button" class="grader-return-next" data-grader="return-next" title="Return, then the next student (Ctrl+Enter or ⌘+Enter)">Return &amp; Next ›</button>';
    return own + _graderRevisionReturnHtml(cid, a, sid, area, !attrs);
  }

  // html-safe: fixed labels; the name and the date go through esc; `act` is the caller's
  function _graderReturnOwnHtml(cid, a, sid, view, act, area) {
    // Out for revision (S11-F1): no Return until the revision is in.
    if (area.kind === 'none' || area.kind === 'revising') return '';
    if (area.kind === 'revised') {
      return '<button type="button" class="grader-return-btn" ' + act + ' disabled>Return</button>';
    }
    if (area.kind === 'marks') {
      return (
        '<button type="button" class="grader-return-btn" ' +
        act +
        '>Return</button>' +
        '<div class="grader-draft"><p class="grader-draft-line">' +
        '<span class="grader-draft-mark">Draft</span><span class="grader-draft-text">Marks saved. Not returned yet.</span>' +
        '</p></div>'
      );
    }
    if (area.kind === 'empty') {
      return '<button type="button" class="grader-return-btn" ' + act + ' disabled>Return</button>';
    }
    if (area.kind === 'returned') {
      var on = area.returnedAt ? formatShortDate(area.returnedAt) : '';
      return '<span class="grader-returned">' + esc(on ? 'Returned ' + on : 'Returned') + '</span>';
    }
    var given = area.given;
    var still = '';
    if (given) {
      var st = getStudents(cid).find(function (x) {
        return x.id === sid;
      });
      var who = view ? view.label : st ? displayNameFirst(st) : 'The student';
      var when = given.returnedAt ? ' ' + formatShortDate(given.returnedAt) : '';
      still = '<p class="grader-draft-still">' + esc(who + ' still sees the grade you returned' + when + '.') + '</p>';
    }
    return (
      '<button type="button" class="grader-return-btn" ' +
      act +
      '>Return</button>' +
      '<div class="grader-draft"><p class="grader-draft-line">' +
      '<span class="grader-draft-mark">Draft</span><span class="grader-draft-text">Saved. Not returned yet.</span>' +
      '</p>' +
      still +
      '</div>'
    );
  }

  /* The row is made only when there is something to say, in the footer
     with the grade (Colin's review council, Nov 13: Return where the eye is
     after the last level, beside the grade it returns), so Return is in
     view however long the grading is. It is redrawn only when it changes: a
     button swapped out under the mouse loses its click. */
  function _refreshGraderReturn(dialog, cid, a, sid, view) {
    var html = _graderReturnHtml(cid, a, sid, view);
    var box = dialog.querySelector('.grader-return');
    if (!html) {
      if (box) {
        box.remove();
        dialog.classList.remove('has-return');
      }
      return;
    }
    if (!box) {
      box = document.createElement('div');
      box.className = 'grader-return';
      dialog.querySelector('.grader-foot').appendChild(box);
      dialog.classList.add('has-return');
      pageState._grader.returnHtml = null;
    }
    if (pageState._grader.returnHtml === html) return;
    pageState._grader.returnHtml = html;
    // html-safe: built by _graderReturnHtml
    box.innerHTML = html;
  }

  function _graderReturn() {
    if (!pageState._grader || !pageState.focusStudentId) return;
    var cid = pageState.activeCourse;
    var a = getAssessments(cid).find(function (x) {
      return x.id === pageState._grader.aid;
    });
    if (!a) return;
    Grader.returnGrades(
      cid,
      a.id,
      _graderReturnIds(pageState.focusStudentId, _graderGroupView(cid, a, pageState.focusStudentId)),
    );
    _refreshGraderChrome();
    // The button is gone: the dialog keeps the keys.
    var dialog = pageState._grader.overlay.querySelector('.grader-dialog');
    if (dialog && !pageState._grader.overlay.contains(document.activeElement)) dialog.focus({ preventScroll: true });
  }

  // Return & Next: the grade on screen goes back, then the next student opens.
  function _graderReturnNext() {
    if (!pageState._grader || !pageState.focusStudentId) return;
    // A comment being typed is saved first (its change event).
    var t = document.activeElement;
    if (t && pageState._grader.overlay.contains(t) && typeof t.blur === 'function') t.blur();
    _graderReturn();
    stepFocusStudent(1);
  }

  /* ── What is waiting to return (S1-F2) ────────────────────
     In a class whose student page is on (the build switch) and that returns
     grades When I Return Them, a grade is a draft until it is returned
     (shared/grade-state.js). The Assignments page then shows:
     - on the toolbar, "N to return": the drafts on screen, summed over the
       assessments listed. Pressed, it leaves only the assessments with one;
     - on a card, "N to return" and "N returned" among its chips, and
       Return N Graded among its buttons, which asks first: the button
       names nobody, so the app's confirm dialog says who gets their grade;
     - on a student's row, the Draft mark, or Returned with its date;
     - with one student open, the dialog's row under each grader: Return
       with the Draft mark and "Saved. Not returned yet.", or Returned.
       Return is one click: it returns the grade on screen. On pair or
       group work a partner's draft goes with it, so it asks first.
     The grader dialog gets Show (To Return, Returned, All), which is what
     ← → step through, and Return N Graded, in a bar under its title.
     In any other class none of it is drawn and nothing here runs past
     _holdsGrades: the page's HTML is what it was
     (tests/assignments-return.test.js).

     Every count is GradeState.draftsIn, which asks GradeState.stateOf, as
     the gradebook, the phone and Class Settings do: a Missing or Excused
     piece is never a draft and a DIBELS benchmark has no state. Who a
     Return N Graded returns, its N, the line of names and the question's
     words are GradeState's (draftsReturned, draftsSentence, returnQuestion,
     returnNGraded), so the three screens say the same. Every return goes
     through Grader.returnGrades. Nothing here changes a number. */
  // True when the class's Student Page is on (the build switch, as the
  // server holds it for a signed-in teacher): its students read the page.
  function _studentPageOn(cid) {
    return !!cid && typeof getReturnSettings === 'function' && getReturnSettings(cid).student_page === true;
  }

  function _holdsGrades(cid) {
    if (!cid || typeof getReturnSettings !== 'function') return false;
    var klass = getReturnSettings(cid);
    return !!klass.student_page && GradeState.holds(klass);
  }

  // The students on screen: the one open, or the whole class.
  function _returnShownIds(cid) {
    if (pageState.focusStudentId) return [pageState.focusStudentId];
    return sortStudents(getStudents(cid), 'lastName').map(function (s) {
      return s.id;
    });
  }

  /* A card's chips: the drafts among the students on screen, and with the
     whole class on screen how many have their grade. */
  // `drafts`, when given, is the count render() worked out.
  // html-safe: numbers and fixed words
  function _returnChipsHtml(cid, a, shownIds, drafts) {
    var n = drafts != null ? drafts : GraderWork.draftsIn(cid, a.id, shownIds).length;
    var given = pageState.focusStudentId
      ? 0
      : shownIds.filter(function (sid) {
          return GradeState.stateOf(cid, sid, a.id) === GradeState.RETURNED;
        }).length;
    return (
      (n ? '<span class="assess-to-return">' + n + ' to return</span>' : '') +
      (given ? '<span class="assess-returned">' + given + ' returned</span>' : '')
    );
  }

  /* A card's Return N Graded, with the whole class on screen: drawn only
     while the assessment has drafts. With one student open, the row under
     their grader has Return. */
  // html-safe: the id is ours; the names and the title go through esc
  function _returnDraftsButtonHtml(cid, a, shownIds) {
    if (pageState.focusStudentId) return '';
    var waiting = GraderWork.draftsReturned(cid, a.id, shownIds);
    if (!waiting.length) return '';
    var label = GradeState.returnNGraded(waiting.length);
    return (
      '<button type="button" class="assess-return-btn" data-action="returnDrafts" data-aid="' +
      a.id +
      '" title="' +
      esc(GradeState.draftsSentence(cid, waiting)) +
      '" aria-label="' +
      esc(label + ', ' + (a.title || 'Assessment')) +
      '">' +
      esc(label) +
      '</button>'
    );
  }

  // The students a row stands for: a group's members still graded with it, or one.
  function _returnMarkIds(aid, sid) {
    var row = _groupRowFor(aid, sid);
    return row && row.view ? row.view.linked.slice() : [sid];
  }

  /* A row's mark: Draft while a grade of the row's waits, Returned (with
     its date, when one is known) once it is given, nothing with no grade. */
  // html-safe: fixed words; the date goes through esc
  function _returnMarkInner(cid, aid, ids) {
    if (GraderWork.draftsIn(cid, aid, ids).length) return '<span class="ret-draft">Draft</span>';
    var on = null;
    var given = ids.filter(function (id) {
      if (GradeState.stateOf(cid, id, aid) !== GradeState.RETURNED) return false;
      var row = getGradeReturn(cid, id, aid);
      if (on == null && row && row.returned_at) on = formatShortDate(row.returned_at);
      return true;
    });
    if (!given.length) return '';
    return '<span class="ret-returned">' + esc(on ? 'Returned ' + on : 'Returned') + '</span>';
  }

  /* The mark beside a student's name in a whole-class grid or ledger.
     '' in a class that holds no grades and on a DIBELS benchmark. */
  // html-safe: ids are ours; the inner HTML is _returnMarkInner's
  function _returnMarkHtml(cid, aid, sid) {
    if (!_holdsGrades(cid)) return '';
    var a = _assessmentById(cid, aid);
    if (!a || isDibelsScored(a)) return '';
    var ids = _returnMarkIds(aid, sid);
    return (
      '<span class="ret-mark" data-ret-aid="' +
      aid +
      '" data-ret-sids="' +
      ids.join(',') +
      '">' +
      _drawnReturn('m' + aid + '|' + ids.join(','), _returnMarkInner(cid, aid, ids)) +
      '</span>'
    );
  }

  /* With one student open: the dialog's row under their grader, Return
     with the Draft mark and its line, or Returned. The row is about the
     student on screen, on pair and group work too (the dialog shows the
     group there; the page shows the student), so it agrees with the count
     on the toolbar and with what Return does (_returnOne). */
  // html-safe: ids are ours; the title goes through esc; the row is _graderReturnHtml's
  function _inlineReturnInner(cid, a, sid) {
    return _graderReturnHtml(
      cid,
      a,
      sid,
      null,
      'data-action="returnOne" data-aid="' +
        a.id +
        '" data-sid="' +
        sid +
        '" aria-label="' +
        esc('Return, ' + (a.title || 'Assessment')) +
        '"',
    );
  }
  // html-safe: ids are ours; the row is _inlineReturnInner's
  function _inlineReturnRowHtml(cid, a, sid) {
    if (!_holdsGrades(cid) || isDibelsScored(a)) return '';
    var html = _drawnReturn('r' + a.id + '|' + sid, _inlineReturnInner(cid, a, sid));
    return (
      '<div class="grader-return grader-return-inline" data-return-row-aid="' +
      a.id +
      '" data-return-row-sid="' +
      sid +
      '"' +
      (html ? '' : ' hidden') +
      '>' +
      html +
      '</div>'
    );
  }

  /* Brings the page's marks, counts and buttons up to date without a
     redraw, after an event that may have saved a grade. Each piece is
     written only when it changes: a button swapped out under the mouse
     loses its click. What a piece holds is remembered on its element, as
     the string its builder made: the browser's own copy of the HTML can
     differ from it (an apostrophe in a title), and would look changed.
     `scope` ({ aid, sid } or { aid }, from _eventScope) is the one piece
     of work, or one student's, an event can have changed; without it,
     everything is. Each card remembers its drafts (_drafts), so the
     toolbar's count is the sum without counting every card again.
     render() calls _seedReturns once it has drawn the page (or cards,
     under `root`), to remember what it drew and write nothing: the
     strings are the ones the draw built (_drawnReturns), not built again. */
  pageState._drawnReturns = null;
  function _drawnReturn(key, html) {
    if (pageState._drawnReturns) pageState._drawnReturns[key] = html;
    return html;
  }
  function _seedReturns(root) {
    if (pageState._grader || !_holdsGrades(pageState.activeCourse) || !document.getElementById('main')) return;
    var kept = pageState._drawnReturns || {};
    root.querySelectorAll('[data-returns-aid]').forEach(function (el) {
      el._drafts = kept['d' + el.dataset.returnsAid];
    });
    // Each piece's selector, its key's letter (_drawnReturn) and the data that names it.
    [
      ['returns-aid', 'c', 'returnsAid'],
      ['return-slot-aid', 's', 'returnSlotAid'],
      ['ret-aid', 'm', 'retAid', 'retSids'],
      ['return-row-aid', 'r', 'returnRowAid', 'returnRowSid'],
    ].forEach(function (k) {
      root.querySelectorAll('[data-' + k[0] + ']').forEach(function (el) {
        var key = k[1] + el.dataset[k[2]] + (k[3] ? '|' + el.dataset[k[3]] : '');
        if (key in kept) el._returnsHtml = kept[key];
      });
    });
  }
  function _refreshReturns(scope) {
    if (pageState._grader) return;
    var cid = pageState.activeCourse;
    var root = document.getElementById('main');
    if (!_holdsGrades(cid) || !root) return;
    var only = scope ? '="' + scope.aid + '"' : '';
    var forStudent = function (sids) {
      return !scope || !scope.sid || sids.indexOf(scope.sid) >= 0;
    };
    var shownIds = _returnShownIds(cid);
    var set = function (el, html) {
      if (el._returnsHtml === html) {
        el._returnsHtml = html;
        return false;
      }
      el._returnsHtml = html;
      // html-safe: every string set here is built by a reviewed builder above
      el.innerHTML = html;
      return true;
    };
    var total = 0;
    root.querySelectorAll('[data-returns-aid]').forEach(function (el) {
      if (!scope || el.dataset.returnsAid === scope.aid) {
        var a = _assessmentById(cid, el.dataset.returnsAid);
        if (!a) return;
        el._drafts = GraderWork.draftsIn(cid, a.id, shownIds).length;
        if (el.closest('.assess-card')) _setHas(el.closest('.assess-card'), 'toreturn', el._drafts > 0);
        set(el, _returnChipsHtml(cid, a, shownIds, el._drafts));
      }
      total += el._drafts || 0;
    });
    root.querySelectorAll('[data-return-slot-aid' + only + ']').forEach(function (el) {
      var a = _assessmentById(cid, el.dataset.returnSlotAid);
      if (a) set(el, _returnDraftsButtonHtml(cid, a, shownIds));
    });
    root.querySelectorAll('[data-ret-aid' + only + ']').forEach(function (el) {
      var sids = el.dataset.retSids.split(',');
      if (forStudent(sids)) set(el, _returnMarkInner(cid, el.dataset.retAid, sids));
    });
    root.querySelectorAll('[data-return-row-aid' + only + ']').forEach(function (el) {
      var a = forStudent([el.dataset.returnRowSid]) && _assessmentById(cid, el.dataset.returnRowAid);
      if (!a) return;
      var html = _inlineReturnInner(cid, a, el.dataset.returnRowSid);
      if (set(el, html)) el.hidden = !html;
    });
    if (total === pageState._toReturnTotal) return;
    pageState._toReturnTotal = total;
    // The last draft is returned: the filter turns off and the list is whole again.
    if (!total && pageState._toReturnOnly) return render();
    AssignShow.syncReturn(pageState.activeCourse, _returnState(pageState.activeCourse));
  }
  function _returnsAfterEvent(scope) {
    if (pageState._grader || !_holdsGrades(pageState.activeCourse)) return;
    setTimeout(function () {
      _refreshReturns(scope);
    }, 0);
  }

  /* Return the drafts `sids` hold on `aid`, and their partners': the
     grader is handed each one's whole pair or group, as the dialog's
     Return hands it, and returns the drafts among them. The drafts are
     counted again here, so a question answered late returns what is
     waiting now. True when any was returned. */
  function _returnDrafts(cid, aid, sids) {
    if (!_holdsGrades(cid)) return false;
    var waiting = GraderWork.draftsIn(cid, aid, sids);
    if (!waiting.length) return false;
    Grader.returnGrades(cid, aid, GradeState.returnTogether(cid, aid, waiting));
    clearProfCache();
    return true;
  }

  /* After a return on the page. With the filter on, a card with nothing
     left to return leaves the list, so the list is drawn again. */
  function _afterPageReturn() {
    if (pageState._toReturnOnly) render();
    else _refreshReturns();
  }

  /* A Return that returns more than the one grade on screen, or names
     nobody, asks first (Colin, 2026-11-10): "Return 3 Grades Now?", who
     is waiting, Return 3 Graded and Cancel. Cancel returns nothing and
     gives `button` the focus back. */
  function _askReturn(cid, waiting, button, then) {
    var n = waiting.length;
    // The dialog gives the focus back to what had it when it opened. Safari
    // does not focus a button it clicks, so the button takes it first.
    if (button && button.focus) button.focus({ preventScroll: true });
    showConfirm(
      GradeState.returnQuestion(n),
      GradeState.draftsSentence(cid, waiting),
      GradeState.returnNGraded(n),
      'primary',
      then,
    );
  }

  /* A card's Return N Graded. The button goes with the drafts, so the
     card's next button takes the focus. */
  function _askReturnDrafts(aid, button) {
    var cid = pageState.activeCourse;
    if (!_holdsGrades(cid) || pageState.focusStudentId) return;
    var waiting = GraderWork.draftsReturned(cid, aid, _returnShownIds(cid));
    if (!waiting.length) return _refreshReturns();
    _askReturn(cid, waiting, button, function () {
      if (pageState.activeCourse !== cid || pageState._grader) return;
      _returnDrafts(cid, aid, _returnShownIds(cid));
      _afterPageReturn();
      var card = document.getElementById('ac-' + aid);
      var next = card && card.querySelector('.assess-header-actions button');
      if (!next) next = document.querySelector('.atb-show [data-show="toreturn"], .assess-search-input');
      if (next) next.focus({ preventScroll: true });
    });
  }

  /* Return under one student's grader on the page. It returns the grade
     on screen, so it is one click. On pair or group work a partner's draft
     goes with it: then it asks first and names everyone. */
  function _returnOne(aid, sid, button) {
    var cid = pageState.activeCourse;
    if (!_holdsGrades(cid)) return;
    var waiting = GraderWork.draftsReturned(cid, aid, [sid]);
    if (!waiting.length) return _refreshReturns();
    var done = function () {
      if (pageState.activeCourse !== cid || pageState._grader) return;
      _returnDrafts(cid, aid, [sid]);
      _afterPageReturn();
      // The button is gone: the student's grader keeps the keys.
      var card = document.getElementById('ac-' + aid);
      var box = card && card.querySelector('.grader-inline');
      var to = box && box.querySelector('.grdt-crit, .grdl-card, .grdp-input, .cmp-btn');
      if (to && !box.contains(document.activeElement)) to.focus({ preventScroll: true });
    };
    if (waiting.length > 1) return _askReturn(cid, waiting, button, done);
    done();
  }

  /* ── Show and Return N Graded in the dialog (S1-F2) ─────────
     A bar under the dialog's title, in a class that holds grades, when the
     dialog steps through more than one student: Show (To Return 3,
     Returned 14, All 28) and Return 3 Graded. The counts are students, as
     the gradebook's and the phone's are. To Return is the drafts among the
     dialog's students; Return N Graded also counts a partner a search has
     hidden, as the gradebook's column does. Show is what ← → step
     through: the student on screen stays until a step, and when the last
     one it lists is gone it goes back to All. */
  var _SHOW_LABELS = {
    tograde: 'To Grade',
    toreturn: 'To Return',
    returned: 'Returned',
    notin: 'Not In',
    all: 'All',
  };
  /* Show's buttons: To Grade and Not In join them while the piece takes
     student work (S6-F3, Grader.workOn). */
  function _graderShowKeys(cid, a) {
    return GraderWork.workOn(cid, a)
      ? ['tograde', 'toreturn', 'returned', 'notin', 'all']
      : ['toreturn', 'returned', 'all'];
  }
  // The bar is drawn: a class that holds grades, or a piece that takes work.
  function _graderShowWanted(cid, a) {
    return (_holdsGrades(cid) || GraderWork.workOn(cid, a)) && !isDibelsScored(a);
  }

  // The dialog's stops, in order: a group or a student each.
  function _graderStops(cid, a) {
    var steps = _graderSteps(cid, a);
    if (steps)
      return steps.map(function (u) {
        return { focus: u.source || u.sid, ids: _unitIds(u) };
      });
    return pageState._grader.studentIds.map(function (sid) {
      return { focus: sid, ids: [sid] };
    });
  }
  /* True when Show lists the stop: one of its students is in what Show
     is on (Grader.workStateOf); for Returned, none of them has a draft. */
  function _stopShown(cid, aid, stop, show) {
    if (!_SHOW_LABELS[show] || show === 'all') return true;
    var states = stop.ids.map(function (id) {
      return GraderWork.workStateOf(cid, aid, id);
    });
    if (show === 'returned' && states.indexOf('toreturn') >= 0) return false;
    return states.indexOf(show) >= 0;
  }
  function _stopIndex(stops, sid) {
    for (var i = 0; i < stops.length; i++) if (stops[i].ids.indexOf(sid) >= 0) return i;
    return -1;
  }
  // The next stop Show lists from the one on screen, or null.
  function _nextShownStop(cid, a, dir) {
    var stops = _graderStops(cid, a);
    var at = _stopIndex(stops, pageState.focusStudentId);
    for (var i = at < 0 && dir < 0 ? stops.length - 1 : at + dir; i >= 0 && i < stops.length; i += dir)
      if (_stopShown(cid, a.id, stops[i], pageState._grader.show)) return stops[i];
    return null;
  }
  function _graderShowOn() {
    return (
      !!pageState._grader &&
      !!pageState._grader.show &&
      pageState._grader.show !== 'all' &&
      !!_SHOW_LABELS[pageState._grader.show]
    );
  }

  // ← → while Show is on To Return or Returned. False when it is on All.
  function _graderStepShown(dir) {
    if (!_graderShowOn()) return false;
    var cid = pageState.activeCourse;
    var a = _assessmentById(cid, pageState._grader.aid);
    if (!a || !_graderShowWanted(cid, a)) return false;
    var next = _nextShownStop(cid, a, dir);
    if (!next) return true;
    pageState._grader.menuSid = null;
    pageState.focusStudentId = next.focus;
    render();
    return true;
  }

  /* The bar's counts, among the students the dialog steps through: the
     one counting function the gradebook and the dashboard call too
     (Grader.workCounts). Students, except a group to grade, which counts
     once. */
  function _graderShowCounts(cid, a) {
    return GraderWork.workCounts(cid, a.id, pageState._grader.studentIds);
  }

  // html-safe: fixed labels and numbers; the names in the title go through esc
  function _graderShowHtml(cid, a, counts) {
    var show = pageState._grader.show || 'all';
    var waiting = GraderWork.draftsReturned(cid, a.id, pageState._grader.studentIds);
    var label = GradeState.returnNGraded(waiting.length);
    return (
      '<div class="seg seg-sm grader-show-seg" role="group" aria-label="Show">' +
      _graderShowKeys(cid, a)
        .map(function (key) {
          return (
            '<button type="button" class="seg-btn"' +
            segAttr(show === key) +
            ' data-grader="show" data-show="' +
            key +
            '"' +
            (counts[key] ? '' : ' disabled') +
            '>' +
            _SHOW_LABELS[key] +
            ' <span class="grader-show-n">' +
            counts[key] +
            '</span></button>'
          );
        })
        .join('') +
      '</div>' +
      (waiting.length
        ? '<button type="button" class="grader-return-all" data-grader="returnAll" title="' +
          esc(GradeState.draftsSentence(cid, waiting)) +
          '">' +
          esc(label) +
          '</button>'
        : '')
    );
  }

  /* The bar is made only in a class that holds grades, under the
     dialog's title bar, and redrawn only when it changes. True when it
     drew the whole dialog again: what Show listed has run out. */
  function _refreshGraderShow(dialog, cid, a) {
    var box = dialog.querySelector('.grader-show');
    var on = _graderShowWanted(cid, a) && pageState._grader.studentIds.length > 1;
    if (!on) {
      if (box) box.remove();
      pageState._grader.show = 'all';
      pageState._grader.showHtml = null;
      return false;
    }
    var counts = _graderShowCounts(cid, a);
    if (_graderShowOn() && !counts[pageState._grader.show]) {
      pageState._grader.show = 'all';
      render();
      return true;
    }
    if (!box) {
      box = document.createElement('div');
      box.className = 'grader-show';
      var slot = dialog.querySelector('.grader-show-slot');
      if (slot) slot.appendChild(box);
      else dialog.querySelector('.grader-toolbar').insertAdjacentElement('afterend', box);
      pageState._grader.showHtml = null;
    }
    var html = _graderShowHtml(cid, a, counts);
    if (pageState._grader.showHtml !== html) {
      pageState._grader.showHtml = html;
      // html-safe: built by _graderShowHtml
      box.innerHTML = html;
    }
    // Previous and Next follow what Show lists.
    if (_graderShowOn()) {
      dialog.querySelector('[data-grader="prev"]').disabled = !_nextShownStop(cid, a, -1);
      dialog.querySelector('[data-grader="next"]').disabled = !_nextShownStop(cid, a, 1);
    }
    return false;
  }

  /* A press on To Return, Returned or All. When the student on screen is
     not one it lists, the first one it lists opens. */
  function _graderSetShow(show) {
    if (!pageState._grader || !_SHOW_LABELS[show]) return;
    var cid = pageState.activeCourse;
    var a = _assessmentById(cid, pageState._grader.aid);
    if (!a || !_graderShowWanted(cid, a)) return;
    pageState._grader.show = show;
    if (_graderShowOn()) {
      var stops = _graderStops(cid, a);
      var at = _stopIndex(stops, pageState.focusStudentId);
      if (at < 0 || !_stopShown(cid, a.id, stops[at], show)) {
        var first = stops.find(function (stop) {
          return _stopShown(cid, a.id, stop, show);
        });
        if (first) {
          pageState._grader.menuSid = null;
          pageState.focusStudentId = first.focus;
          _graderToTop();
        }
      }
    }
    render();
    var pressed =
      pageState._grader &&
      pageState._grader.overlay.querySelector('.grader-show [data-show="' + pageState._grader.show + '"]');
    if (pressed) pressed.focus({ preventScroll: true });
  }

  /* Return N Graded in the dialog: every draft among the dialog's
     students, and their partners'. It asks first, unless the only drafts
     are the grade on screen, which the dialog's own Return returns in one
     click. */
  function _graderReturnAll(button) {
    if (!pageState._grader) return;
    var cid = pageState.activeCourse;
    var a = _assessmentById(cid, pageState._grader.aid);
    if (!a || !_holdsGrades(cid)) return;
    var ids = pageState._grader.studentIds;
    var waiting = GraderWork.draftsReturned(cid, a.id, ids);
    if (!waiting.length) return _refreshGraderChrome();
    var overlay = pageState._grader.overlay;
    var done = function () {
      if (!pageState._grader || pageState._grader.overlay !== overlay || pageState.activeCourse !== cid) return;
      _returnDrafts(cid, a.id, ids);
      _refreshGraderChrome();
      // The button is gone: the dialog keeps the keys.
      var dialog = pageState._grader && pageState._grader.overlay.querySelector('.grader-dialog');
      if (dialog && !pageState._grader.overlay.contains(document.activeElement)) dialog.focus({ preventScroll: true });
    };
    var onScreen = _graderReturnIds(pageState.focusStudentId, _graderGroupView(cid, a, pageState.focusStudentId));
    var justThese = waiting.every(function (sid) {
      return onScreen.indexOf(sid) >= 0;
    });
    if (justThese) return done();
    _askReturn(cid, waiting, button, done);
  }

  /* ── The student's work in the dialog (S6-F1 to F3) ────────
     In a class whose student page (the build switch) and Send Work are on,
     on a piece whose Students Send is not Nothing (Grader.workOn), the
     dialog grows a work pane beside the scoring panel:
     - under the student's name, what came in ("Submitted Oct 30, 8:41 pm
       · 2 photos", "Not In · 7 days late"), "Same photo as Mia K." when a
       page is byte for byte another student's, and a strip of the students
       whose work waits;
     - every page the student sent, one under the other, each with its
       own bar (its number, Rotate, the view only, and Mark Up); over them
       Whole Page and Fit Width and Focus on Work; under them the
       student's note and Unsubmit;
     - with nothing in: Add Work (Choose Files, shrunk as a student's are,
       shared/photo-shrink.js) and Grade From Paper's Set Logan To.
     Focus on Work gives the page the room and narrows the scoring to a
     column with short level names (EMG, DEV, PRF, EXT).
     Demo Mode only for now: signed in, the data layer answers nothing is in
     and Add Work answers not_available (S6-W1 wires it). Every answer from
     the photo store, a file shrink or a confirm checks that the dialog
     still shows the same piece and student before it draws. */
  var _WORK_ROTATE_ICON =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';
  var _WORK_SHORT = { 1: 'EMG', 2: 'DEV', 3: 'PRF', 4: 'EXT' };

  // html-safe: the parts' fixed markup
  function _graderWorkShellHtml() {
    return (
      // The Show bar sits in the top bar here, beside Print Rubrics, not in a row of its own.
      _graderToolbarHtml().replace(
        '<div class="grader-toolbar-start"></div>',
        '<div class="grader-toolbar-lead"><div class="grader-toolbar-start"></div><div class="grader-show-slot"></div></div>',
      ) +
      '<div class="grader-scroll grader-scroll-work">' +
      // One row over the work and the scoring (Colin, Nov 13): the name,
      // when the work came in, how the pages show, and the status.
      _graderHeadHtml().replace(
        '<span class="grader-spacer"></span>',
        '<div class="grader-work-line"></div><div class="grader-work-view"></div><span class="grader-spacer"></span>',
      ) +
      '<div class="grader-split">' +
      '<section class="grader-work" aria-label="Student work"></section>' +
      '<div class="grader-panel-col">' +
      _graderPanelHtml() +
      '</div></div></div>' +
      _graderFootHtml()
    );
  }

  // The shell changed under a drawn dialog: what it remembers drawing is gone.
  function _graderForgetDrawn() {
    [
      'statusHtml',
      'markHtml',
      'membersHtml',
      'lineHtml',
      'returnHtml',
      'showHtml',
      'workHtml',
      'workLineHtml',
      'workToolsHtml',
      'reflectHtml',
      'revisionHtml',
    ].forEach(function (k) {
      pageState._grader[k] = null;
    });
    _graderReleasePage(pageState._grader);
  }

  // A photo's address holds its bytes until it is let go (openStudentWorkPage).
  function _graderReleasePage(g) {
    if (!g || !g.work) return;
    var pics = g.work.pics || {};
    g.work.pics = {};
    Object.keys(pics).forEach(function (key) {
      if (pics[key].release) pics[key].release();
    });
  }

  function _workStudent(cid, sid) {
    return (
      getStudents(cid).find(function (x) {
        return x.id === sid;
      }) || null
    );
  }

  // "Oct 30, 8:41 pm"
  function _workWhen(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    var day = formatShortDate(String(ts).slice(0, 10));
    var time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
    return day + ', ' + time;
  }

  function _workPhotos(n) {
    return n + (n === 1 ? ' photo' : ' photos');
  }
  // "2 photos", "1 link", "2 photos · 1 link": a submission's pages and the links added to it (Demo Mode).
  function _workPhotosAndLinks(sub) {
    var n = ((sub && sub.files) || []).length;
    var links = ((sub && sub.links) || []).length;
    if (!links) return _workPhotos(n);
    var said = links + (links === 1 ? ' link' : ' links');
    return n ? _workPhotos(n) + ' · ' + said : said;
  }

  /* The work the grader shows for `sid` (S12-F2): on a One per Group
     piece the group's, whoever sent it (getGroupWorkFiles), as one
     submission-like answer { group: true, sender, sent_at, note, noteBy,
     files, own }; otherwise the student's own submission, as before. */
  function _workSubOf(cid, sid, aid) {
    var own = getStudentSubmission(cid, sid, aid);
    var group = typeof getStudentWorkGroup === 'function' ? getStudentWorkGroup(cid, sid, aid) : null;
    if (!group) return own;
    var subs = getGroupSubmissions(cid, sid, aid);
    if (!subs.length) return null;
    var first = subs.slice().sort(function (x, y) {
      return String(x.sent_at || x.created_at) < String(y.sent_at || y.created_at) ? -1 : 1;
    })[0];
    var noted = subs.find(function (x) {
      return x.note;
    });
    return {
      group: true,
      sender: first.enrollment_id,
      sent_by: first.sent_by,
      sent_at: first.sent_at,
      created_at: first.created_at,
      on_paper: subs.every(function (x) {
        return x.on_paper;
      }),
      note: noted ? noted.note : null,
      noteBy: noted ? noted.enrollment_id : null,
      files: getGroupWorkFiles(cid, sid, aid),
      own: own,
    };
  }

  /* The line under the name: what came in, or that nothing has. */
  function _workLineText(cid, a, sid, sub) {
    if (sub && sub.group && !sub.on_paper) {
      // "Sent by Priya S. for the group, Nov 3 · 4 photos"
      var by = sub.sent_by === 'teacher' ? null : _workStudent(cid, sub.sender);
      var day =
        sub.sent_at || sub.created_at ? formatShortDate(String(sub.sent_at || sub.created_at).slice(0, 10)) : '';
      return (
        (by ? 'Sent by ' + _workShortName(by) + ' for the group' : 'Added by you for the group') +
        (day ? ', ' + day : '') +
        ' · ' +
        _workPhotos((sub.files || []).length)
      );
    }
    if (sub) {
      // A revision in (S11-F3): "Revised Nov 9, 7:12 pm · 1 new page".
      var rv = _graderRevisionOf(cid, a, sid);
      if (_revisionIn(rv) && rv.revision_submission_id === sub.id) {
        var n = (sub.files || []).length;
        var at = _revisionWhen(rv.revision_sent_at);
        return 'Revised' + (at ? ' ' + at : '') + ' · ' + n + (n === 1 ? ' new page' : ' new pages');
      }
      if (sub.on_paper) return 'Handed in on paper';
      var when = _workWhen(sub.sent_at || sub.created_at);
      var verb = sub.sent_by === 'teacher' ? 'Added by you' : 'Submitted';
      return verb + (when ? ' ' + when : '') + ' · ' + _workPhotosAndLinks(sub);
    }
    var status = getAssignmentStatus(cid, sid, a.id);
    if (status === 'EXC') return 'Excused';
    var head = status === 'NS' ? 'Missing' : 'Not In';
    var due = a.dueDate || a.due_date || null;
    if (!due) return head;
    var days = Math.round((Date.parse(courseToday(cid)) - Date.parse(String(due).slice(0, 10))) / 86400000);
    if (days > 0) return head + ' · ' + days + (days === 1 ? ' day late' : ' days late');
    return head + ' · Due ' + formatShortDate(String(due).slice(0, 10));
  }

  // "Mia K."
  function _workShortName(st) {
    if (!st) return '';
    var last = String(st.lastName || '').trim();
    return displayNameFirst(st) + (last ? ' ' + last.charAt(0) + '.' : '');
  }

  /* The line: what came in, Same photo as, and the strip of the students
     whose work waits (up to five, then "+2"). Redrawn only when it changes. */
  // html-safe: names go through esc; ids are ours; labels are fixed words
  function _workLineHtml(cid, a, sid) {
    var sub = _workSubOf(cid, sid, a.id);
    var html = '<span class="grader-work-what">' + esc(_workLineText(cid, a, sid, sub)) + '</span>';
    GraderWork.samePhotoAs(cid, a.id, sid, pageState._grader.studentIds).forEach(function (other) {
      var st = _workStudent(cid, other);
      if (!st) return;
      html +=
        '<button type="button" class="grader-work-same" data-grader="work-open" data-sid="' +
        other +
        '" title="' +
        esc('A page of this work is the same photo, byte for byte, as one of ' + displayNameWithLast(st) + '’s.') +
        '">' +
        esc('Same photo as ' + _workShortName(st)) +
        '</button>';
    });
    var waiting = GraderWork.workCounts(cid, a.id, pageState._grader.studentIds).ids.tograde;
    // Group work (S12-F2): one button a group, "Groups to grade".
    var units = waiting.length ? _graderUnits(cid, a) : null;
    if (units) {
      var on = _graderGroupView(cid, a, sid);
      var shownUnits = units.filter(function (u) {
        return _unitIds(u).some(function (id) {
          return waiting.indexOf(id) >= 0;
        });
      });
      var firstUnits = shownUnits.slice(0, 5);
      var moreUnits = shownUnits.length - firstUnits.length;
      return (
        html +
        '<span class="grader-work-strip" role="group" aria-label="Groups to grade">' +
        firstUnits
          .map(function (u) {
            var to = u.source || u.sid;
            var here = on ? !!u.linked && u.linked.indexOf(sid) >= 0 : u.sid === sid;
            var st = u.linked ? null : _workStudent(cid, u.sid);
            var name = u.linked ? collabGroupLabel(u.group) : st ? displayNameWithLast(st) : '';
            var face = u.linked ? String(u.group.index + 1) : st ? initials(st) : '';
            return (
              '<button type="button" class="grader-work-who' +
              (here ? ' is-on' : '') +
              '" data-grader="work-open" data-sid="' +
              to +
              '" aria-label="' +
              esc(name) +
              '" title="' +
              esc(name) +
              '"' +
              (here ? ' aria-current="true"' : '') +
              '>' +
              esc(face) +
              '</button>'
            );
          })
          .join('') +
        (moreUnits
          ? '<button type="button" class="grader-work-who grader-work-more" data-grader="show" data-show="tograde" aria-label="' +
            moreUnits +
            ' more to grade">+' +
            moreUnits +
            '</button>'
          : '') +
        '</span>'
      );
    }
    if (waiting.length) {
      var shown = waiting.slice(0, 5);
      var more = waiting.length - shown.length;
      html +=
        '<span class="grader-work-strip" role="group" aria-label="Students to grade">' +
        shown
          .map(function (id) {
            var st = _workStudent(cid, id);
            var name = st ? displayNameWithLast(st) : '';
            return (
              '<button type="button" class="grader-work-who' +
              (id === sid ? ' is-on' : '') +
              '" data-grader="work-open" data-sid="' +
              id +
              '" aria-label="' +
              esc(name) +
              '" title="' +
              esc(name) +
              '"' +
              (id === sid ? ' aria-current="true"' : '') +
              '>' +
              esc(st ? initials(st) : '') +
              '</button>'
            );
          })
          .join('') +
        (more
          ? '<button type="button" class="grader-work-who grader-work-more" data-grader="show" data-show="tograde" aria-label="' +
            more +
            ' more to grade">+' +
            more +
            '</button>'
          : '') +
        '</span>';
    }
    return html;
  }

  function _refreshGraderWorkLine(dialog, cid, a, sid) {
    var line = dialog.querySelector('.grader-work-line');
    if (!line) return;
    var html = _workLineHtml(cid, a, sid);
    if (pageState._grader.workLineHtml === html) return;
    pageState._grader.workLineHtml = html;
    // html-safe: built by _workLineHtml
    line.innerHTML = html;
  }

  /* The work the pane shows: _workSubOf's, or, while a revision is in and
     First is chosen (S11-F3), the first version. */
  function _workPaneSubOf(cid, sid, aid) {
    var sub = _workSubOf(cid, sid, aid);
    var w = pageState._grader && pageState._grader.work;
    if (!w || w.version !== 'first' || !sub || sub.group) return sub;
    var a = _assessmentById(cid, aid);
    var r = _graderRevisionOf(cid, a, sid);
    if (!_revisionIn(r) || r.revision_submission_id !== sub.id) return sub;
    return _revisionFirstSub(cid, a, sid, r) || sub;
  }

  /* New and First, while a revision is in (S11-F3): which version's pages
     the pane shows. '' otherwise. */
  // html-safe: dates from formatShortDate through esc; labels are fixed words
  function _workVersionsHtml(cid, a, sid) {
    var r = _graderRevisionOf(cid, a, sid);
    var sub = _workSubOf(cid, sid, a.id);
    if (!_revisionIn(r) || !sub || r.revision_submission_id !== sub.id) return '';
    var firstSub = _revisionFirstSub(cid, a, sid, r);
    if (!firstSub || firstSub.id === sub.id) return '';
    var first = pageState._grader.work.version === 'first';
    var newDay = r.revision_sent_at ? formatShortDate(r.revision_sent_at) : '';
    var firstDay = _revisionFirstDay(cid, a, sid, r);
    return (
      '<div class="seg seg-sm grader-work-versions" role="group" aria-label="Version">' +
      '<button type="button" class="seg-btn"' +
      segAttr(!first) +
      ' data-grader="work-version" data-version="new">' +
      esc('New' + (newDay ? ' · ' + newDay : '')) +
      '</button><button type="button" class="seg-btn"' +
      segAttr(first) +
      ' data-grader="work-version" data-version="first">' +
      esc('First' + (firstDay ? ' · ' + firstDay : '')) +
      '</button></div>'
    );
  }

  // Mark Up is kept for the student to read: only where the student page's rows are kept.
  function _markUpHere(cid) {
    return _formWorkDemo() || (typeof studentWorkLive === 'function' && studentWorkLive(cid));
  }

  /* All Pages: the columns and rows that show `n` pages at once, as large
     as a portrait page can be in a pane about as tall as it is wide: side
     by side up to three, then two or three rows (four at most across). */
  function _workGrid(n) {
    var cols = n <= 3 ? n : n === 4 ? 2 : n <= 6 ? 3 : 4;
    return { cols: Math.max(1, cols), rows: Math.min(3, Math.ceil(n / Math.max(1, cols))) };
  }

  /* How the pages are shown, in the student row beside the name (Colin,
     Nov 13: fewer rows of buttons over the page): New and First while a
     revision is in, All Pages, Whole Page and Fit Width, and Focus on
     Work. '' with no pages. */
  // html-safe: fixed labels; the versions' dates go through esc
  // `sub` and `versions` are worked out once a draw, in _drawGraderWork.
  function _workToolsHtml(sub, versions) {
    var w = pageState._grader.work;
    var files = (sub && sub.files) || [];
    if (!files.length) return '';
    var fit = _workFit(w, files.length);
    return (
      versions +
      '<div class="seg seg-sm grader-work-fit" role="group" aria-label="Show">' +
      // Two choices (the review council, Nov 13: three read alike): every
      // page side by side, or each page the column's full width, one under
      // the other. One page: the whole page, or full width.
      (files.length > 1 ? ['all', 'width'] : ['page', 'width'])
        .map(function (f) {
          return (
            '<button type="button" class="seg-btn"' +
            segAttr(fit === f) +
            ' data-grader="work-fit" data-fit="' +
            f +
            '">' +
            (f === 'all' ? 'Side by Side' : f === 'page' ? 'Whole Page' : 'Full Width') +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '<button type="button" class="grader-work-tool grader-work-focus" data-grader="work-focus" aria-pressed="' +
      !!w.focus +
      '">Focus on Work</button>'
    );
  }

  // Side by Side (every page in view at once) or Full Width; one page shows whole or full width.
  function _workFit(w, n) {
    if (w.fit === 'width') return 'width';
    return n > 1 ? 'all' : 'page';
  }

  // The teacher's choice of Side by Side or Full Width, kept on this device for the next dialog.
  var _WORK_FIT_KEY = 'fv-grader-work-fit';
  function _workFitSaved() {
    try {
      return localStorage.getItem(_WORK_FIT_KEY) === 'width' ? 'width' : 'all';
    } catch (e) {
      return 'all';
    }
  }

  /* The pane for `st`: their pages, or Add Work when nothing is in. */
  // html-safe: names and the note go through esc; ids are ours; labels are fixed words
  function _workPaneHtml(cid, a, st, view, sub, versions) {
    var w = pageState._grader.work;
    // The first version is for looking at: Mark Up and Unsubmit are the new one's.
    var onFirst = !!versions && w.version === 'first';
    var first = view ? view.label : displayNameFirst(st);
    var files = (sub && sub.files) || [];
    if (!sub) return _addWorkHtml(cid, a, st, first);
    // Unsubmit puts one student's own piece back to not handed in; a group's is not offered here.
    var foot =
      sub.group || onFirst
        ? ''
        : '<div class="grader-work-foot"><button type="button" class="grader-work-unsubmit" data-grader="work-unsubmit">Unsubmit</button></div>';
    var links = _workLinksHtml(sub);
    if (!files.length && !links)
      return '<div class="grader-work-empty"><p>Handed in on paper. Grade it from the paper.</p></div>' + foot;
    var fit = _workFit(w, files.length);
    var grid = _workGrid(files.length);
    var markUp = !!(window.MarkUp && !onFirst && _markUpHere(cid));
    var html = !files.length
      ? ''
      : // Every page the student sent at once (Colin, Nov 13: "I shouldn't
        // have to switch pages"). On each page's corner: its number, Rotate
        // (the view only) and Mark Up (S9-F1, teacher/markup.js).
        '<div class="grader-work-pages fit-' +
        fit +
        (fit === 'all' ? ' cols-' + grid.cols + ' rows-' + grid.rows : '') +
        '">' +
        files
          .map(function (file, at) {
            var turn = w.turns[file.id] || 0;
            var what = 'Page ' + (at + 1) + ' of ' + files.length;
            var size =
              file.width > 0 && file.height > 0
                ? ' width="' + Math.round(file.width) + '" height="' + Math.round(file.height) + '"'
                : '';
            return (
              '<section class="grader-work-sheet" aria-label="' +
              esc(what) +
              '"><div class="grader-work-corner"><span class="grader-work-at">' +
              esc(what) +
              '</span><span class="grader-spacer"></span>' +
              '<button type="button" class="grader-work-tool grader-work-rotate" data-grader="work-rotate" data-at="' +
              at +
              '" aria-label="' +
              esc('Rotate ' + what) +
              '" title="Rotate">' +
              _WORK_ROTATE_ICON +
              '</button>' +
              (markUp
                ? '<button type="button" class="grader-work-tool grader-work-markup" data-grader="work-markup" data-at="' +
                  at +
                  '">Mark Up</button>'
                : '') +
              '</div>' +
              '<div class="grader-work-page fit-' +
              fit +
              ' turn-' +
              turn +
              (fit === 'all' ? '" title="Click to see this page full width' : '') +
              // The page's surface (S9-T1): the picture, and whatever is drawn
              // over it (Mark Up), turn and fit together inside it.
              '"><div class="grader-work-surface" data-file-id="' +
              esc(file.id) +
              '" data-page="' +
              (at + 1) +
              '"><img class="grader-work-img" alt="' +
              esc('Page ' + (at + 1) + ' of ' + (a.title || 'the work')) +
              '"' +
              size +
              '></div></div></section>'
            );
          })
          .join('') +
        '</div>';
    // Links the teacher attached from the row's + (Demo Mode), under the pages.
    html += links;
    // A revision's note is on its Revision card (S11-F3).
    if (sub.note && !(versions && !onFirst)) {
      var noteBy = sub.group ? _workStudent(cid, sub.noteBy) : null;
      html +=
        '<div class="grader-work-note"><h3 class="grader-work-note-title">' +
        esc(
          sub.group
            ? (noteBy ? displayNameFirst(noteBy) : 'The group') + '’s Note, Sent for the Group'
            : first + '’s Note, Sent With the Work',
        ) +
        '</h3><p>' +
        esc(sub.note) +
        '</p></div>';
    }
    return html + foot;
  }

  /* The links on a submission, each opening in a new tab. Only http(s)
     addresses are drawn (addStudentWorkLink checked them as they came in). */
  // html-safe: the address, its site and its name go through esc; the icon is fixed
  function _workLinksHtml(sub) {
    var links = ((sub && sub.links) || []).filter(function (l) {
      return l && /^https?:\/\//i.test(String(l.url || ''));
    });
    if (!links.length) return '';
    return (
      '<div class="grader-work-links"><h3 class="grader-work-note-title">' +
      (links.length === 1 ? 'Link' : 'Links') +
      '</h3><ul class="grader-work-link-list">' +
      links
        .map(function (l) {
          return (
            '<li><a class="grader-work-link" href="' +
            esc(l.url) +
            '" target="_blank" rel="noopener noreferrer" title="' +
            esc(l.url) +
            '">' +
            LINE_ICONS.link +
            '<span class="grader-work-link-name">' +
            esc(l.title || l.url) +
            '</span><span class="grader-work-link-host">' +
            esc(l.host || '') +
            '</span></a></li>'
          );
        })
        .join('') +
      '</ul></div>'
    );
  }

  /* Nothing in: Add Work, and Grade From Paper's Set Logan To. */
  // html-safe: the name goes through esc; labels are fixed words; levels are numbers
  function _addWorkHtml(cid, a, st, first) {
    var w = pageState._grader.work;
    var levels = !isPointsScored(a) && !isCompletionScored(a) && _setEveryonePlan(cid, a.id).perStudent > 0;
    var open = w.setTo === st.id;
    return (
      '<div class="grader-addwork">' +
      '<h3 class="grader-addwork-title">' +
      esc('Add Work for ' + first) +
      '</h3>' +
      '<p class="grader-addwork-hint">Photos or PDFs. Photos are made smaller before they upload.</p>' +
      '<label class="grader-addwork-choose' +
      (w.busy ? ' is-busy' : '') +
      '"><input type="file" class="grader-work-files" multiple accept="image/*,.heic,.heif,application/pdf"' +
      (w.busy ? ' disabled' : '') +
      '>' +
      (w.busy ? 'Adding…' : 'Choose Files') +
      '</label>' +
      '<p class="grader-addwork-msg" role="status">' +
      esc(w.msg || '') +
      '</p>' +
      (levels
        ? '<h3 class="grader-addwork-title">Grade From Paper</h3>' +
          '<div class="grader-setto"><button type="button" class="grader-setto-btn" data-grader="work-setto-menu" aria-haspopup="menu" aria-expanded="' +
          open +
          '">' +
          esc('Set ' + first + ' To') +
          '</button>' +
          '<div class="grader-setto-menu" role="menu"' +
          (open ? '' : ' hidden') +
          '>' +
          // The same options as a grid row's fill: a dot and the level's name.
          _rowFillOptionsHtml(cid, 'graderSetTo', a.id, st.id) +
          '</div></div>'
        : '') +
      '</div>'
    );
  }

  /* The pane, drawn only when it changes; every page's picture is fetched
     once, and let go when its page is no longer shown. Where the pages had
     been scrolled to is kept when the pane is drawn again. */
  function _drawGraderWork(dialog, cid, a, st, view) {
    var pane = dialog.querySelector('.grader-work');
    if (!pane) return;
    // The submission and its versions, read once for the whole draw.
    var sub = _workPaneSubOf(cid, st.id, a.id);
    var versions = view ? '' : _workVersionsHtml(cid, a, st.id);
    var tools = dialog.querySelector('.grader-work-view');
    var toolsHtml = _workToolsHtml(sub, versions);
    if (tools && pageState._grader.workToolsHtml !== toolsHtml) {
      pageState._grader.workToolsHtml = toolsHtml;
      // html-safe: built by _workToolsHtml
      tools.innerHTML = toolsHtml;
    }
    var html = _workPaneHtml(cid, a, st, view, sub, versions);
    if (pageState._grader.workHtml !== html) {
      pageState._grader.workHtml = html;
      var was = pane.querySelector('.grader-work-pages');
      var top = was ? was.scrollTop : 0;
      // html-safe: built by _workPaneHtml
      pane.innerHTML = html;
      var now = pane.querySelector('.grader-work-pages');
      if (now && top) now.scrollTop = top;
    }
    var files = (sub && sub.files) || [];
    var surfaces = pane.querySelectorAll('.grader-work-surface');
    if (!surfaces.length || !files.length) return _graderReleasePage(pageState._grader);
    var w = pageState._grader.work;
    if (!w.pics) w.pics = {};
    var g = pageState._grader;
    var keep = {};
    Array.prototype.forEach.call(surfaces, function (surface) {
      var file = files.find(function (f) {
        return f && String(f.id) === surface.dataset.fileId;
      });
      var img = surface.querySelector('.grader-work-img');
      if (!file || !img) return;
      _drawGraderMarks(surface, cid, file);
      var key = [cid, a.id, st.id, file.id, file.path].join('|');
      keep[key] = true;
      var pic = w.pics[key];
      if (pic) {
        // The pane was drawn again: a picture already fetched goes back in.
        if (pic.url && img.getAttribute('src') !== pic.url) img.src = pic.url;
        return;
      }
      pic = w.pics[key] = { url: null, release: null };
      openStudentWorkPage(cid, file, 'page').then(function (res) {
        // The dialog moved on (another student, version or piece, or closed).
        if (pageState._grader !== g || g.work.pics[key] !== pic) {
          if (res) res.release();
          return;
        }
        if (!res) return;
        pic.url = res.url;
        pic.release = res.release;
        Array.prototype.forEach.call(g.overlay.querySelectorAll('.grader-work-surface'), function (el) {
          var shown = el.dataset.fileId === String(file.id) && el.querySelector('.grader-work-img');
          if (shown) shown.src = res.url;
        });
      });
    });
    // Pictures of pages no longer shown are let go.
    Object.keys(w.pics).forEach(function (key) {
      if (keep[key]) return;
      if (w.pics[key].release) w.pics[key].release();
      delete w.pics[key];
    });
  }

  /* The teacher's marks on a page (S9-F1), over the picture on its
     surface: the working copy, what Return gives the student. Drawn
     again only when the marks or the page's shape change; the shape is the
     picture's, once it has loaded. */
  function _drawGraderMarks(surface, cid, file) {
    var img = surface && surface.querySelector('.grader-work-img');
    if (!surface || !img || !window.MarkupDraw) return;
    if (!img._markupLoad) {
      img._markupLoad = true;
      var g = pageState._grader;
      img.addEventListener('load', function () {
        if (pageState._grader === g && img.isConnected) _drawGraderMarks(surface, cid, file);
      });
    }
    var row = typeof getPageMarkup === 'function' ? getPageMarkup(cid, file.id) : null;
    var marks = row && row.marks && row.marks.marks && row.marks.marks.length ? row.marks : null;
    var html = marks ? MarkupDraw.svgHtml(marks, MarkupDraw.aspect(img)) : '';
    var layer = surface.querySelector('.markup-layer');
    if (layer && layer._html === html) return;
    if (layer) layer.remove();
    if (!html) return;
    // html-safe: built by MarkupDraw.svgHtml, which escapes a note's words
    img.insertAdjacentHTML('afterend', html);
    surface.querySelector('.markup-layer')._html = html;
  }

  /* The page on screen in the work pane, for a layer drawn over it (S9-T1,
     Mark Up): { el, img, cid, aid, sid, fileId, page, turn }, or null when
     no page shows. `el` is the surface: the picture fills it, it turns and
     fits with the picture, and a child placed over it with position:
     absolute and inset: 0 lies exactly on the page. */
  function workSurface() {
    if (!pageState._grader || !pageState._grader.workShell) return null;
    // The page last acted on (Rotate or Mark Up on its bar), else the first.
    var el =
      pageState._grader.overlay.querySelector(
        '.grader-work-surface[data-page="' + (pageState._grader.work.page + 1) + '"]',
      ) || pageState._grader.overlay.querySelector('.grader-work-surface');
    if (!el) return null;
    var a = _assessmentById(pageState.activeCourse, pageState._grader.aid);
    var sub = a && _workPaneSubOf(pageState.activeCourse, pageState.focusStudentId, a.id);
    var file =
      sub &&
      (sub.files || []).find(function (f) {
        return f && String(f.id) === el.dataset.fileId;
      });
    if (!file) return null;
    return {
      el: el,
      img: el.querySelector('.grader-work-img'),
      cid: pageState.activeCourse,
      aid: a.id,
      sid: pageState.focusStudentId,
      fileId: file.id,
      page: parseInt(el.dataset.page, 10),
      turn: pageState._grader.work.turns[file.id] || 0,
    };
  }

  /* In Focus on Work the scoring's level buttons show EMG, DEV, PRF and
     EXT, and keep their whole names for a screen reader and the hover. */
  function _graderShortLevels(dialog) {
    if (!dialog.classList.contains('is-focus')) return;
    dialog.querySelectorAll('.grader-panel-col button[data-level]').forEach(function (b) {
      var short = _WORK_SHORT[b.dataset.level];
      var name = b.textContent.trim();
      if (!short || !name || b.children.length) return;
      b.setAttribute('aria-label', name);
      b.title = name;
      // html-safe: fixed short names and the level's fixed name
      b.innerHTML =
        '<span class="lvl-full">' +
        esc(name) +
        '</span><span class="lvl-short" aria-hidden="true">' +
        short +
        '</span>';
    });
  }

  function _graderWorkAction(what, btn) {
    if (!pageState._grader) return;
    var cid = pageState.activeCourse;
    var a = _assessmentById(cid, pageState._grader.aid);
    var sid = pageState.focusStudentId;
    if (!a || !sid) return;
    var w = pageState._grader.work;
    var again = null;
    // The page a page's own button acts on (its bar's data-at).
    var at = parseInt(btn.dataset.at, 10);
    if (at >= 0) w.page = at;
    if (what === 'work-fit') {
      w.fit = btn.dataset.fit === 'width' ? 'width' : 'all';
      try {
        localStorage.setItem(_WORK_FIT_KEY, w.fit);
      } catch (e) {
        /* the choice lasts this dialog only */
      }
      again = '[data-grader="work-fit"][data-fit="' + w.fit + '"]';
    } else if (what === 'work-version') {
      // New or First (S11-F3): the chosen version opens on its first page.
      var version = btn.dataset.version === 'first' ? 'first' : null;
      if (w.version !== version) w.page = 0;
      w.version = version;
      again = '[data-grader="work-version"][data-version="' + (version || 'new') + '"]';
    } else if (what === 'work-rotate') {
      var sub = _workPaneSubOf(cid, sid, a.id);
      var file = sub && (sub.files || [])[w.page];
      if (file) w.turns[file.id] = ((w.turns[file.id] || 0) + 90) % 360;
      again = '[data-grader="work-rotate"][data-at="' + w.page + '"]';
    } else if (what === 'work-focus') {
      w.focus = !w.focus;
      // The page fills the width it is given, as the board draws it.
      if (w.focus) w.fit = 'width';
      again = '[data-grader="work-focus"]';
    } else if (what === 'work-open') {
      if (!btn.dataset.sid || pageState._grader.studentIds.indexOf(btn.dataset.sid) < 0) return;
      pageState._grader.menuSid = null;
      pageState.focusStudentId = btn.dataset.sid;
      _graderToTop();
    } else if (what === 'work-setto-menu') {
      w.setTo = w.setTo === sid ? null : sid;
      again = '[data-grader="work-setto-menu"]';
    } else if (what === 'work-setto') {
      w.setTo = null;
      _graderSetTo(cid, a, sid, parseInt(btn.dataset.score, 10), btn.textContent.replace(/^\s*\d\s*/, '').trim());
    } else if (what === 'work-unsubmit') {
      return _graderAskUnsubmit(cid, a, sid, btn);
    } else if (what === 'work-markup') {
      return _graderOpenMarkUp(cid, a, sid);
    } else return;
    render();
    var to = again && pageState._grader && pageState._grader.overlay.querySelector(again);
    if (to && !to.disabled) to.focus({ preventScroll: true });
  }

  /* A page clicked in Side by Side: every page full width, this one at the
     top of the column. Not kept as the teacher's choice. */
  function _graderWorkEnlarge(tile) {
    var surface = tile.querySelector('.grader-work-surface');
    var at = surface ? parseInt(surface.dataset.page, 10) - 1 : 0;
    pageState._grader.work.fit = 'width';
    pageState._grader.work.page = Math.max(0, at);
    render();
    var pages = pageState._grader && pageState._grader.overlay.querySelector('.grader-work-pages');
    var sheet = pages && pages.querySelectorAll('.grader-work-sheet')[pageState._grader.work.page];
    if (sheet) pages.scrollTop = sheet.offsetTop - pages.offsetTop;
  }

  /* Mark Up (S9-F1), on the page the pane shows. Done comes back here with
     the marks drawn over the page and the Return row up to date. */
  function _graderOpenMarkUp(cid, a, sid) {
    var g = pageState._grader;
    var w = g.work;
    MarkUp.open({
      cid: cid,
      aid: a.id,
      sid: sid,
      page: w.page,
      turn: Object.assign({}, w.turns),
      onClose: function () {
        if (
          pageState._grader !== g ||
          pageState.activeCourse !== cid ||
          g.aid !== a.id ||
          pageState.focusStudentId !== sid
        )
          return;
        render();
        var b = g.overlay.querySelector('[data-grader="work-markup"][data-at="' + w.page + '"]');
        if (b) b.focus({ preventScroll: true });
      },
    });
  }

  /* A new student opens on their first page. */
  function _graderWorkStudentChanged() {
    var w = pageState._grader && pageState._grader.work;
    if (!w || w.sid === pageState.focusStudentId) return;
    w.sid = pageState.focusStudentId;
    w.page = 0;
    w.msg = '';
    w.setTo = null;
    w.version = null;
    pageState._grader.revisionMsg = null;
  }

  /* Grade From Paper: Set Logan To (GraderWork.setToFromPaper, which the
     phone's not-in card can call too). Undo puts the levels back. */
  function _graderSetTo(cid, a, sid, level, label) {
    var before = structuredClone(getScores(cid));
    var done = GraderWork.setToFromPaper(cid, a.id, sid, level);
    refreshSidebarGrades(sid);
    var after = structuredClone(getScores(cid));
    var st = _workStudent(cid, sid);
    var g = pageState._grader;
    done.paper.then(function () {
      if (pageState._grader === g && pageState.activeCourse === cid && g.aid === a.id) render();
    });
    if (!done.set) return;
    _showFillUndo((st ? displayNameFirst(st) : 'Student') + ' set to ' + label, function () {
      Grader.undo(cid, before, after);
      render();
      refreshSidebarGrades();
    });
  }

  /* Add Work's Choose Files: the files are shrunk and their pages kept in
     order by AddWorkFiles (shared/add-work-files.js), then recorded as the
     teacher's work (addStudentWorkPages). */
  function _graderAddWorkFiles(input) {
    if (!pageState._grader || pageState._grader.work.busy) return;
    var files = Array.prototype.slice.call(input.files || []);
    input.value = '';
    if (!files.length || !window.PhotoShrink) return;
    var cid = pageState.activeCourse;
    var aid = pageState._grader.aid;
    var sid = pageState.focusStudentId;
    var g = pageState._grader;
    var same = function () {
      return (
        pageState._grader === g && pageState.activeCourse === cid && g.aid === aid && pageState.focusStudentId === sid
      );
    };
    g.work.busy = true;
    g.work.msg = '';
    render();
    var said = '';
    AddWorkFiles.prepare(files)
      .then(function (got) {
        said = got.said;
        if (said || !got.pages.length) return { result: 'refused' };
        return addStudentWorkPages(cid, sid, aid, got.pages, { mode: 'new' });
      })
      .then(null, function () {
        return { result: 'store_failed' };
      })
      .then(function (res) {
        g.work.busy = false;
        if (pageState._grader !== g) return;
        // A line about this student's files is said only on their screen.
        if (same()) {
          g.work.msg = res.result === 'sent' ? '' : said || AddWorkFiles.answer(res);
          g.work.page = 0;
        }
        render();
      });
  }

  /* Unsubmit (was Delete Work, Colin's ruling 87; Nov 17 2026): the work
     goes, the piece is back to not handed in, the grade and comments stay.
     The words are GraderWork.unsubmitAsk's, the phone's too. */
  function _graderAskUnsubmit(cid, a, sid, button) {
    var st = _workStudent(cid, sid);
    var sub = getStudentSubmission(cid, sid, a.id);
    if (!st || !sub) return;
    var g = pageState._grader;
    var ask = GraderWork.unsubmitAsk(a, st, sub);
    if (button && button.focus) button.focus({ preventScroll: true });
    showConfirm(
      ask.title,
      ask.message,
      'Unsubmit',
      ask.danger ? 'danger' : 'primary',
      function () {
        if (pageState._grader !== g || pageState.activeCourse !== cid || pageState.focusStudentId !== sid) return;
        GraderWork.deleteWork(cid, sid, a.id).then(function () {
          if (pageState._grader !== g || pageState.activeCourse !== cid) return;
          if (pageState.focusStudentId === sid) g.work.page = 0;
          render();
        });
      },
      'Keep It',
    );
  }

  /* ── Revisions in the grader (S11-F1, S11-F3) ───────────────
     The boards "Teacher: Return for Revision" and "Teacher: Grading a
     Revision, Both Versions". In a class whose revisions are on (Demo Mode,
     the build switch and Send Work: GraderWork.revisionsOnInClass), on one
     student's own piece (not a group's):
     - Return for Revision beside Return opens the sheet: What to Fix,
       Revise By and which criteria (a rubric's). The grade is kept until
       the new version replaces it: the board's Hide is left out (Colin,
       Nov 11). It returns the work, then asks for another try
       (Grader.returnForRevision);
     - out for revision, the row says so in place of Return, with the
       Revise By date, and Take Back (Grader.cancelRevision);
     - once the revision is in: "Revised Nov 9, 7:12 pm · 1 new page", New
       and First pages, the Revision card (what was asked, the student's
       note), "Was Developing + on the Oct 30 version" on each criterion,
       and Before and After once the new grade is in. While the new grade
       is a draft these screens show it, marked Draft (Colin, Nov 11); the
       student keeps the old grade until it is returned.
     With the revisions off none of it is drawn: the dialog is as it was.
     Every answer is drawn only while the dialog still shows the same class,
     piece and student; the sheet's Return for Revision acts only while the
     sheet is still open on them. */
  function _graderRevisionOf(cid, a, sid) {
    if (!a || isDibelsScored(a) || !GraderWork.revisionsOnInClass(cid)) return null;
    var r = typeof getRevisionRequest === 'function' ? getRevisionRequest(cid, sid, a.id) : null;
    return r && r.state !== 'cancelled' ? r : null;
  }
  // The revision is in (sent, being graded, or its grade returned).
  function _revisionIn(r) {
    return !!r && !!r.revision_submission_id && r.state !== 'open';
  }
  // "Tue, Nov 10" for a 'YYYY-MM-DD'.
  function _reviseByText(day) {
    var d = parseLocalDate(String(day || ''));
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  // "Nov 9, 7:12 pm", on the teacher's own clock.
  function _revisionWhen(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return (
      formatShortDate(ts) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
    );
  }
  // The first version's submission, or null.
  function _revisionFirstSub(cid, a, sid, r) {
    var all = typeof getSubmissionVersions === 'function' ? getSubmissionVersions(cid, sid, a.id) : [];
    return (
      all.find(function (s) {
        return s.id === r.first_submission_id;
      }) ||
      all[0] ||
      null
    );
  }
  // "Oct 30": when the first version came in, or '' when it is not known.
  function _revisionFirstDay(cid, a, sid, r) {
    var sub = _revisionFirstSub(cid, a, sid, r);
    var at = (sub && (sub.sent_at || sub.created_at)) || r.first_returned_at;
    return at ? formatShortDate(at) : '';
  }

  // Return for Revision, or the state of the request and Take Back, after the row's Return.
  // html-safe: fixed labels; the name and the dates go through esc
  function _graderRevisionReturnHtml(cid, a, sid, area, buttons) {
    var g = pageState._grader;
    var busy = !!(g && g.revisionBusy);
    if (area.revise) {
      if (!buttons) return '';
      return (
        '<button type="button" class="grader-revise-btn" data-grader="revision-open"' +
        (busy ? ' disabled' : '') +
        '>Return for Revision</button>'
      );
    }
    var r = area.revision;
    if (!r) return '';
    var html = '<div class="grader-draft grader-revision-line">';
    if (area.kind === 'revising') {
      html +=
        '<p class="grader-draft-line"><span class="grader-revising-mark">Revising</span><span class="grader-draft-text">' +
        esc('Returned for Revision' + (r.revise_by ? ' · Revise by ' + _reviseByText(r.revise_by) : '')) +
        '</span></p>';
    }
    html += '</div>';
    if (!buttons) return html;
    var msg = g && g.revisionMsg ? '<p class="grader-revision-msg" role="status">' + esc(g.revisionMsg) + '</p>' : '';
    return (
      html +
      msg +
      '<button type="button" class="grader-takeback-btn" data-grader="revision-takeback" data-id="' +
      esc(r.id) +
      '"' +
      (busy ? ' disabled' : '') +
      '>' +
      (busy ? 'Taking Back…' : 'Take Back') +
      '</button>'
    );
  }

  function _graderRevisionAction(what, btn) {
    if (!pageState._grader) return;
    var cid = pageState.activeCourse;
    var a = _assessmentById(cid, pageState._grader.aid);
    var sid = pageState.focusStudentId;
    if (!a || !sid || pageState._grader.revisionBusy) return;
    if (what === 'revision-open') return _graderOpenRevisionSheet(cid, a, sid);
    if (what === 'revision-takeback') return _graderTakeBack(cid, a, sid, btn.dataset.id);
  }

  function _revisionKey(prefix) {
    return window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  /* Take Back: the request is withdrawn. */
  function _graderTakeBack(cid, a, sid, requestId) {
    var r = _graderRevisionOf(cid, a, sid);
    if (!r || r.id !== requestId) return;
    var g = pageState._grader;
    g.revisionBusy = true;
    g.revisionMsg = null;
    _refreshGraderChrome();
    Grader.cancelRevision(cid, sid, a.id, r.id, _revisionKey('rc')).then(function (res) {
      g.revisionBusy = false;
      if (
        pageState._grader !== g ||
        pageState.activeCourse !== cid ||
        g.aid !== a.id ||
        pageState.focusStudentId !== sid
      )
        return;
      var ok = res && (res.result === 'cancelled' || res.result === 'not_open');
      g.revisionMsg = ok ? null : 'This couldn’t be taken back. Try again.';
      render();
      var back = g.overlay.querySelector('[data-grader="revision-open"], [data-grader="revision-takeback"]');
      (back || g.overlay.querySelector('.grader-dialog')).focus({ preventScroll: true });
    });
  }

  /* The Return for Revision sheet, over the grader. */
  // html-safe: names, titles and criterion names go through esc; ids are escaped; labels are fixed words
  function _revisionSheetHtml(cid, a, st) {
    var rubric = a.rubricId ? getRubricById(cid, a.rubricId) : null;
    var criteria = ((rubric && rubric.criteria) || []).filter(Boolean);
    return (
      '<div class="grader-sheet" role="dialog" aria-modal="true" aria-labelledby="grader-sheet-title" tabindex="-1">' +
      '<h2 class="grader-sheet-title" id="grader-sheet-title">Return for Revision</h2>' +
      '<p class="grader-sheet-sub">' +
      esc(displayNameWithLast(st) + ' · ' + (a.title || 'Assessment')) +
      '</p>' +
      '<label class="grader-sheet-label" for="grader-sheet-fix">What to Fix</label>' +
      '<textarea id="grader-sheet-fix" class="grader-sheet-fix" rows="3" maxlength="2000"></textarea>' +
      '<label class="grader-sheet-label" for="grader-sheet-by">Revise By</label>' +
      '<input type="date" id="grader-sheet-by" class="grader-sheet-by">' +
      (criteria.length > 1
        ? '<label class="grader-sheet-label" for="grader-sheet-crit">Revise</label>' +
          '<select id="grader-sheet-crit" class="grader-sheet-crit"><option value="">The Whole Assignment</option>' +
          criteria
            .map(function (c) {
              return '<option value="' + esc(c.id) + '">' + esc((c.name || 'Criterion') + ' only') + '</option>';
            })
            .join('') +
          '</select>'
        : '') +
      // The grade until then: kept (Hide is left out, Colin, Nov 11).
      '<h3 class="grader-sheet-label">Until the New Version Is Graded</h3>' +
      '<p class="grader-sheet-keep">Keep this grade. The new version replaces it.</p>' +
      '<p class="grader-sheet-msg" role="status"></p>' +
      '<div class="grader-sheet-actions">' +
      '<button type="button" class="btn btn-secondary" data-rv="cancel">Cancel</button>' +
      '<button type="button" class="btn btn-primary" data-rv="send">Return for Revision</button>' +
      '</div></div>'
    );
  }

  function _graderOpenRevisionSheet(cid, a, sid) {
    var g = pageState._grader;
    var st = _workStudent(cid, sid);
    if (!st || g.overlay.querySelector('.grader-sheet-back')) return;
    var back = document.createElement('div');
    back.className = 'grader-sheet-back';
    // html-safe: built by _revisionSheetHtml
    back.innerHTML = _revisionSheetHtml(cid, a, st);
    g.overlay.appendChild(back);
    var sheet = back.querySelector('.grader-sheet');
    var fix = sheet.querySelector('.grader-sheet-fix');
    var busy = false;
    var fields = function () {
      return Array.prototype.slice.call(sheet.querySelectorAll('button, textarea, input, select'));
    };
    var close = function () {
      back.remove();
      if (pageState._grader !== g) return;
      var to = g.overlay.querySelector('[data-grader="revision-open"]') || g.overlay.querySelector('.grader-dialog');
      if (to) to.focus({ preventScroll: true });
    };
    var say = function (text) {
      sheet.querySelector('.grader-sheet-msg').textContent = text;
    };
    var send = function () {
      if (busy) return;
      var text = fix.value;
      if (!text.trim()) {
        say('Write what to fix first.');
        fix.focus();
        return;
      }
      var crit = sheet.querySelector('.grader-sheet-crit');
      var request = {
        what_to_fix: text.slice(0, 2000),
        revise_by: sheet.querySelector('.grader-sheet-by').value || null,
        criterion_ids: crit && crit.value ? [crit.value] : [],
      };
      var was = fields().map(function (el) {
        return el.disabled;
      });
      busy = true;
      fields().forEach(function (el) {
        el.disabled = true;
      });
      sheet.querySelector('[data-rv="send"]').textContent = 'Returning…';
      Grader.returnForRevision(cid, sid, a.id, request, _revisionKey('rv')).then(function (res) {
        // The sheet or the dialog went, or moved on: nothing more happens here.
        if (
          !back.isConnected ||
          pageState._grader !== g ||
          pageState.activeCourse !== cid ||
          g.aid !== a.id ||
          pageState.focusStudentId !== sid
        )
          return;
        var result = res && res.result;
        if (result === 'made' || result === 'already_open') {
          back.remove();
          render();
          var tb = g.overlay.querySelector('[data-grader="revision-takeback"]');
          (tb || g.overlay.querySelector('.grader-dialog')).focus({ preventScroll: true });
          return;
        }
        busy = false;
        fields().forEach(function (el, i) {
          el.disabled = was[i];
        });
        sheet.querySelector('[data-rv="send"]').textContent = 'Return for Revision';
        say(
          result === 'invalid'
            ? 'Check What to Fix and the date, then try again.'
            : 'This couldn’t be returned for revision. Try again.',
        );
      });
    };
    back.addEventListener('click', function (e) {
      var b = e.target.closest('[data-rv]');
      if (!b || b.disabled) return;
      if (b.dataset.rv === 'cancel') close();
      else if (b.dataset.rv === 'send') send();
    });
    // The sheet keeps its keys: no scoring shortcut, step or close below it.
    back.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault();
        if (!busy) close();
        return;
      }
      if (e.key !== 'Tab') return;
      var all = fields().filter(function (el) {
        return !el.disabled;
      });
      if (!all.length) return;
      var at = all.indexOf(document.activeElement);
      if (e.shiftKey && at <= 0) {
        e.preventDefault();
        all[all.length - 1].focus();
      } else if (!e.shiftKey && at === all.length - 1) {
        e.preventDefault();
        all[0].focus();
      }
    });
    back.addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });
    fix.focus();
  }

  /* The Revision card above the scoring, once the revision is in: what was
     asked, the student's note, and Before and After once the new grade is
     in (the first version's result and the grade now, a draft marked so). */
  function _cellShown(cid, cell) {
    if (!cell) return '';
    if (cell.kind === 'level') return formatLevel(cid, cell.value);
    return cell.kind === 'none' ? '' : String(cell.text || '');
  }
  // The levels of the first version and now, per criterion (or competency): [{ id, name, before, after }].
  function _revisionLevelRows(cid, a, sid, r) {
    var firstCopy = r.first_grade || {};
    var rows = [];
    var rubric = a.rubricId ? getRubricById(cid, a.rubricId) : null;
    if (rubric) {
      (rubric.criteria || []).filter(Boolean).forEach(function (crit) {
        var was = null;
        rubricCriterionScoreKeys(crit).some(function (k) {
          var p = (firstCopy.criteria || {})[k];
          if (p && p.value > 0) was = p;
          return !!was;
        });
        var now = _criterionState(cid, sid, a.id, crit);
        rows.push({
          id: crit.id,
          name: crit.name || 'Criterion',
          before: was ? scoreLevelText(was.value, was.modifier) : '',
          after: now.level ? scoreLevelText(now.level, now.mod) : '',
        });
      });
      return rows;
    }
    if (isPointsScored(a) || isCompletionScored(a)) return rows;
    _scoreTagObjs(cid, a).forEach(function (tag) {
      var p = (firstCopy.tags || {})[tag.id];
      var now = _tagState(cid, sid, a.id, tag.id);
      rows.push({
        id: tag.id,
        name: tag.label || 'Competency',
        before: p && p.value > 0 ? scoreLevelText(p.value, p.modifier) : '',
        after: now.level ? scoreLevelText(now.level, now.mod) : '',
      });
    });
    return rows;
  }

  // "(a day early)", "(3 days late)": when the revision came in against Revise By.
  function _revisionTiming(r) {
    if (!r.revise_by || !r.revision_sent_at) return '';
    var sent = new Date(r.revision_sent_at);
    if (isNaN(sent.getTime())) return '';
    var day = new Date(sent.getFullYear(), sent.getMonth(), sent.getDate());
    var days = Math.round((parseLocalDate(r.revise_by) - day) / 86400000);
    if (days > 1) return ' (' + days + ' days early)';
    if (days === 1) return ' (a day early)';
    if (days === 0) return ' (on the day)';
    return days === -1 ? ' (a day late)' : ' (' + -days + ' days late)';
  }

  // html-safe: the student's words, names, dates and levels go through esc; labels are fixed words
  function _graderRevisionCardHtml(cid, a, st) {
    var r = _graderRevisionOf(cid, a, st.id);
    if (!_revisionIn(r)) return '';
    var when = r.revision_sent_at ? formatShortDate(r.revision_sent_at) : '';
    var html =
      '<section class="grader-revision" aria-labelledby="grader-revision-title">' +
      '<h3 class="grader-revision-title" id="grader-revision-title">' +
      esc('Revision, Sent' + (when ? ' ' + when : '') + _revisionTiming(r)) +
      '</h3>' +
      '<p class="grader-revision-who">You asked:</p><p class="grader-revision-said">' +
      esc(r.what_to_fix || '') +
      '</p>';
    if (r.revision_note)
      html +=
        '<p class="grader-revision-who">' +
        esc(displayNameFirst(st) + '’s note:') +
        '</p><p class="grader-revision-said">' +
        esc(r.revision_note) +
        '</p>';
    // Before and After: once the new grade is in (a draft, or returned).
    var firstCell = r.state === 'grading' || r.state === 'returned' ? getRevisionFirstCell(cid, st.id, a.id) : null;
    if (firstCell) {
      var draft = GradeState.stateOf(cid, st.id, a.id) === GradeState.DRAFT;
      html += '<div class="grader-revision-ba"><h4 class="grader-revision-ba-title">Before and After</h4><dl>';
      _revisionLevelRows(cid, a, st.id, r).forEach(function (row) {
        if (!row.before && !row.after) return;
        html +=
          '<div class="grader-revision-ba-row"><dt>' +
          esc(row.name) +
          '</dt><dd class="grader-revision-before">' +
          esc(row.before === row.after ? 'No change' : row.before || '—') +
          '</dd><dd class="grader-revision-after">' +
          esc(row.after || '—') +
          '</dd></div>';
      });
      html +=
        '<div class="grader-revision-ba-row is-result"><dt>Result</dt><dd class="grader-revision-before">' +
        esc(_cellShown(cid, firstCell)) +
        '</dd><dd class="grader-revision-after">' +
        esc(_cellShown(cid, assessmentCellValue(cid, st.id, a)) || '—') +
        (draft ? ' <span class="grader-draft-mark">Draft</span>' : '') +
        '</dd></div></dl></div>';
    }
    return html + '</section>';
  }

  function _refreshGraderRevision(dialog, cid, a, st) {
    var html = _graderRevisionCardHtml(cid, a, st);
    var box = dialog.querySelector('.grader-revision-host');
    if (!html) {
      if (box) box.remove();
      pageState._grader.revisionHtml = null;
      return;
    }
    if (!box) {
      var anchor = dialog.querySelector('.grader-separate-line');
      if (!anchor) return;
      box = document.createElement('div');
      box.className = 'grader-revision-host';
      anchor.insertAdjacentElement('beforebegin', box);
      pageState._grader.revisionHtml = null;
    }
    if (pageState._grader.revisionHtml === html) return;
    pageState._grader.revisionHtml = html;
    // html-safe: built by _graderRevisionCardHtml
    box.innerHTML = html;
  }

  /* "Was Developing + on the Oct 30 version" on each criterion (or
     competency) the first version had a level for, once the revision is
     in; and "Pick the level for the new version." while the revision is not
     graded yet, on the criteria the request named (all, when it named none). */
  function _refreshGraderWas(dialog, cid, a, sid) {
    var r = _graderRevisionOf(cid, a, sid);
    var rows = _revisionIn(r) ? _revisionLevelRows(cid, a, sid, r) : [];
    var day = rows.length ? _revisionFirstDay(cid, a, sid, r) : '';
    var named = (r && r.criterion_ids) || [];
    var cards = dialog.querySelectorAll('.grader-body .grdt-crit[data-critid], .grader-body .grdl-card[data-tag]');
    Array.prototype.forEach.call(cards, function (card) {
      var id = String(card.dataset.critid || card.dataset.tag);
      var row = rows.find(function (x) {
        return String(x.id) === id;
      });
      var text = row && row.before ? 'Was ' + row.before + ' on the ' + (day ? day + ' version' : 'first version') : '';
      var pick = !!text && r.state === 'sent' && (!named.length || named.indexOf(id) >= 0);
      var key = text + (pick ? '|pick' : '');
      var was = card.querySelector('.grader-was');
      if ((was ? was._fvKey : '') === key) return;
      if (was) was.remove();
      if (!text) return;
      // An amber chip under the level bar (MainRevised).
      var bar = card.querySelector('.grdl-controls, .grsp-controls');
      if (!bar) return;
      was = document.createElement('div');
      was.className = 'grader-was';
      var line = document.createElement('p');
      line.className = 'grader-was-line';
      line.textContent = text;
      was.appendChild(line);
      if (pick) {
        var hint = document.createElement('p');
        hint.className = 'grader-was-hint';
        hint.textContent = 'Pick the level for the new version.';
        was.appendChild(hint);
      }
      was._fvKey = key;
      bar.parentNode.insertBefore(was, bar.nextSibling);
    });
  }

  /* ── A student's reflection in the grader (S10-F3) ─────────
     The board "Teacher: Grader, Returned Work With a Reflection". In a
     class whose student page (the build switch) and Reflect on Feedback
     are on, a student who has a grade back can say whether the feedback
     makes sense, ask a question and make a plan (shared/data.js, "Reflect
     on Feedback"). Their reflection shows above the scoring, on that
     student's grader only:
     - not sure: what they asked, a box for the answer and Send Answer;
       then, once they say whether it makes sense now, the follow-up and a
       second answer;
     - makes sense: their plan and what went well, and Save as
       Observation, which keeps their words as one of the teacher's notes
       on them (addQuickOb), linked to the piece.
     The student wrote it under "Only Mr. Brown sees this": their words
     show on this student's grader only, and nothing here sends them
     anywhere but the teacher's own notes. Send Answer's answer goes to
     this student alone (answerReflection). Demo Mode only for now: signed
     in no reflection is read (S10-W1). The row is made only when there is
     a reflection, so with the switch off the dialog is as it was. */
  function _graderReflection(cid, a, sid) {
    // getStudentReflections lists none while Reflect on Feedback is off.
    if (typeof getStudentReflections !== 'function' || isDibelsScored(a)) return null;
    return (
      getStudentReflections(cid, sid).find(function (r) {
        return r.assessment_id === a.id;
      }) || null
    );
  }

  // "Nov 4, the day after you returned it"
  function _reflectWhen(cid, a, sid, r) {
    var day = String(r.sent_at || '').slice(0, 10);
    if (!day) return '';
    var out = formatShortDate(day);
    var row = getGradeReturn(cid, sid, a.id);
    var back = row && row.returned_at ? String(row.returned_at).slice(0, 10) : '';
    if (!back || back > day) return out;
    var days = Math.round((Date.parse(day) - Date.parse(back)) / 86400000);
    if (days === 0) return out + ', the day you returned it';
    if (days === 1) return out + ', the day after you returned it';
    return out + ', ' + days + ' days after you returned it';
  }

  // The words Save as Observation keeps: the student's own, quoted.
  function _reflectObservationText(a, r) {
    var out = [];
    if (r.plan) out.push('Plan after ' + (a.title || 'this work') + ': “' + r.plan.trim() + '”');
    if (r.went_well) out.push('Went well: “' + r.went_well.trim() + '”');
    return out.join(' ');
  }
  function _reflectSaved(cid, sid, a, r) {
    var text = _reflectObservationText(a, r);
    if (!text) return false;
    return ((getQuickObs(cid) || {})[sid] || []).some(function (o) {
      return o && o.text === text && o.assignmentContext && o.assignmentContext.assessmentId === a.id;
    });
  }

  // html-safe: the student's words, names and dates go through esc; ids are escaped; labels are fixed words
  function _graderReflectionHtml(cid, a, st) {
    var r = _graderReflection(cid, a, st.id);
    if (!r) return '';
    var first = displayNameFirst(st);
    var said = function (who, text) {
      return '<p class="grader-reflect-who">' + esc(who) + '</p><p class="grader-reflect-said">' + esc(text) + '</p>';
    };
    var on = function (ts) {
      return formatShortDate(String(ts || '').slice(0, 10));
    };
    var html =
      '<section class="grader-reflect" aria-labelledby="grader-reflect-title">' +
      '<div class="grader-reflect-head"><h3 id="grader-reflect-title" class="grader-reflect-title">' +
      esc(first + '’s Reflection') +
      '</h3><p class="grader-reflect-when">' +
      esc(_reflectWhen(cid, a, st.id, r)) +
      '</p></div>';
    if (r.makes_sense === 'not_sure') {
      html += '<p class="grader-reflect-sense is-unsure">Not sure about the feedback</p>';
      html += said(first + ' asks:', r.question || '');
    } else {
      html += '<p class="grader-reflect-sense">The feedback makes sense</p>';
    }
    if (r.plan) html += said(first + '’s plan:', r.plan);
    if (r.went_well) html += said('What went well:', r.went_well);
    if (r.answer) html += said('You answered ' + on(r.answered_at) + ':', r.answer);
    if (r.sense_now === 'yes')
      html += '<p class="grader-reflect-now">' + esc(first + ' says it makes sense now.') + '</p>';
    if (r.follow_up) html += said(first + ' is still not sure and asks:', r.follow_up);
    if (r.follow_up_answer) html += said('You answered ' + on(r.follow_up_answered_at) + ':', r.follow_up_answer);
    var busy = pageState._grader.reflectBusy === r.id;
    if (r.waiting) {
      html +=
        '<label class="grader-reflect-label" for="grader-reflect-answer">' +
        esc('Your answer to ' + first) +
        '</label>' +
        '<textarea id="grader-reflect-answer" class="grader-reflect-input" rows="3" maxlength="2000" data-id="' +
        esc(r.id) +
        '"' +
        (busy ? ' disabled' : '') +
        '></textarea>' +
        '<div class="grader-reflect-actions">' +
        '<button type="button" class="btn btn-primary btn-sm grader-reflect-send" data-grader="reflect-send" data-id="' +
        esc(r.id) +
        '"' +
        (busy ? ' disabled' : '') +
        '>' +
        (busy ? 'Sending…' : 'Send Answer') +
        '</button>' +
        '<span class="grader-reflect-only">' +
        esc('Only ' + first + ' sees your answer.') +
        '</span></div>';
    }
    if (r.plan || r.went_well) {
      var saved = _reflectSaved(cid, st.id, a, r);
      html +=
        '<div class="grader-reflect-actions"><button type="button" class="btn btn-secondary btn-sm grader-reflect-obs" data-grader="reflect-observe" data-id="' +
        esc(r.id) +
        '"' +
        (saved ? ' disabled' : '') +
        '>' +
        (saved ? 'Saved as Observation' : 'Save as Observation') +
        '</button></div>';
    }
    var msg =
      pageState._grader.reflectMsg && pageState._grader.reflectMsg.id === r.id ? pageState._grader.reflectMsg.text : '';
    html += '<p class="grader-reflect-msg" role="status">' + esc(msg) + '</p>';
    return html + '</section>';
  }

  /* The row sits above the scoring, in both layouts, and is made only when
     there is a reflection. Redrawn only when it changes; an answer being
     written goes back in its box. */
  function _refreshGraderReflection(dialog, cid, a, st) {
    var html = _graderReflectionHtml(cid, a, st);
    var box = dialog.querySelector('.grader-reflect-host');
    if (!html) {
      if (box) box.remove();
      pageState._grader.reflectHtml = null;
      return;
    }
    if (!box) {
      var anchor = dialog.querySelector('.grader-separate-line');
      if (!anchor) return;
      box = document.createElement('div');
      box.className = 'grader-reflect-host';
      anchor.insertAdjacentElement('beforebegin', box);
      pageState._grader.reflectHtml = null;
    }
    if (pageState._grader.reflectHtml === html) return;
    pageState._grader.reflectHtml = html;
    var had = document.activeElement && box.contains(document.activeElement) ? document.activeElement : null;
    var typing = !!had && had.classList.contains('grader-reflect-input');
    // html-safe: built by _graderReflectionHtml
    box.innerHTML = html;
    var input = box.querySelector('.grader-reflect-input');
    if (input) {
      input.value = pageState._grader.reflectDrafts[input.dataset.id] || '';
      if (typing) input.focus({ preventScroll: true });
    }
  }

  function _graderReflectAction(what, btn) {
    if (!pageState._grader) return;
    var cid = pageState.activeCourse;
    var a = _assessmentById(cid, pageState._grader.aid);
    var sid = pageState.focusStudentId;
    if (!a || !sid) return;
    var r = _graderReflection(cid, a, sid);
    if (!r || r.id !== btn.dataset.id) return;
    if (what === 'reflect-send') return _graderSendAnswer(cid, a, sid, r);
    if (what === 'reflect-observe') return _graderSaveReflection(cid, a, sid, r);
  }

  function _reflectAnswerLine(res) {
    if (res.result === 'already_answered') return 'This was answered already. The answer is shown.';
    if (res.result === 'not_found') return 'This reflection is no longer here.';
    if (res.result === 'not_available') return 'Answers can’t be sent from this class.';
    if (res.result === 'failed') return 'The answer couldn’t be sent. Try again.';
    return 'Write an answer first.';
  }

  /* Send Answer: the answer goes to this student alone. The data layer's
     answer is drawn only while the dialog still shows this piece and
     student; the box keeps what was typed when it was not sent. */
  function _graderSendAnswer(cid, a, sid, r) {
    var g = pageState._grader;
    if (g.reflectBusy) return;
    var input = g.overlay.querySelector('.grader-reflect-input');
    var text = input ? input.value : g.reflectDrafts[r.id] || '';
    g.reflectDrafts[r.id] = text;
    g.reflectMsg = null;
    if (!text.trim()) {
      g.reflectMsg = { id: r.id, text: 'Write an answer first.' };
      render();
      var box = g.overlay.querySelector('.grader-reflect-input');
      if (box) box.focus({ preventScroll: true });
      return;
    }
    g.reflectBusy = r.id;
    render();
    var key =
      window.crypto && crypto.randomUUID
        ? crypto.randomUUID()
        : 'ra-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    answerReflection(cid, r.id, text.slice(0, 2000), key).then(function (res) {
      g.reflectBusy = null;
      if (res && res.result === 'answered') delete g.reflectDrafts[r.id];
      if (
        pageState._grader !== g ||
        pageState.activeCourse !== cid ||
        g.aid !== a.id ||
        pageState.focusStudentId !== sid
      )
        return;
      g.reflectMsg = res && res.result === 'answered' ? null : { id: r.id, text: _reflectAnswerLine(res || {}) };
      render();
    });
  }

  /* Save as Observation: the student's plan and what went well, quoted,
     as a Note on them linked to the piece. Once only. Its context marks it
     as from a reflection (REFLECTION_OBS_CONTEXT, shared/constants.js), so
     no report or comment ever offers or prints it (Colin's ruling 110). */
  function _graderSaveReflection(cid, a, sid, r) {
    var text = _reflectObservationText(a, r);
    if (!text || _reflectSaved(cid, sid, a, r)) return;
    var ok = addQuickOb(cid, sid, text, [], 'note', REFLECTION_OBS_CONTEXT, {
      assessmentId: a.id,
      assessmentTitle: a.title || '',
    });
    pageState._grader.reflectMsg =
      ok === false ? { id: r.id, text: 'The observation couldn’t be kept on this computer. Try again.' } : null;
    render();
    var b = pageState._grader && pageState._grader.overlay.querySelector('[data-grader="reflect-observe"]');
    if (b) b.focus({ preventScroll: true });
  }

  /* ── Note for the Report ──────────────────────────────────
     One line about what the student did, for the comment's best-piece
     sentence (score.report_note). Not on DIBELS or Complete/Incomplete
     work, which is never a best piece. It is saved with the student's
     score, so it waits for one. */
  var _REPORT_NOTE_TITLE = 'What the student did well here. Their report comment uses it if this is their best piece.';
  var _REPORT_NOTE_LOCKED_TITLE = 'Score this work first. The note is saved with the score.';

  function _refreshReportNote(dialog, cid, a, sid) {
    var card = dialog.querySelector('.grader-report-note');
    if (!card) return;
    var never = isDibelsScored(a) || isCompletionScored(a);
    card.hidden = never;
    if (never) return;
    var input = card.querySelector('.grader-report-note-input');
    // The saved note goes in only when the student or work changes: this
    // runs after every click and key, typing in the box too.
    if (input.dataset.sid !== sid || input.dataset.aid !== a.id) {
      input.dataset.sid = sid;
      input.dataset.aid = a.id;
      input.value = getScoreReportNote(cid, sid, a.id);
      // Open where a note is written; closed for the next student otherwise.
      card.open = !!String(input.value || '').trim();
    }
    var scored = (getScores(cid)[sid] || []).some(function (e) {
      return e && e.assessmentId === a.id;
    });
    input.disabled = !scored;
    input.title = scored ? _REPORT_NOTE_TITLE : _REPORT_NOTE_LOCKED_TITLE;
    _reportNotePreview(input);
  }

  /* The best-piece sentence this note makes, as the comment would read it
     (teacher/comment-bank.js), the title's quotes turned single inside the
     preview's own. A note that does not start with a past-tense verb
     (CommentLint.startsPastTense) is saved but not used: the sentence
     shows its no-note form and an orange line, shown only then, says why. */
  var _REPORT_NOTE_HINT =
    'Your note isn\u2019t used yet: start it with what the student did, like \u201Cused \u2026\u201D or \u201Cexplained \u2026\u201D.';
  function _reportNotePreview(input) {
    var cid = pageState.activeCourse;
    var preview = input.parentNode.querySelector('.grader-report-note-preview');
    var st = getStudents(cid).find(function (x) {
      return x.id === input.dataset.sid;
    });
    var a = getAssessments(cid).find(function (x) {
      return x.id === input.dataset.aid;
    });
    if (!preview || !st || !a) return;
    // With no note, the skill the piece shows, as the comment would say it
    // (CommentBank.bestPieceSkillOf).
    var skill = '';
    if (!String(input.value || '').trim() && CommentBank.bestPieceSkillOf) {
      // The grader is the teacher's own screen: all work, whatever the questionnaire's set (S2-F2).
      var f = ReportScores.withReportScores('grader', function () {
        return CommentBank.facts(cid, st);
      });
      var w = (f.work || []).find(function (x) {
        return x.id === a.id;
      });
      skill = (w && (CommentBank.bestPieceSkillOf(f, w) || {}).skill) || '';
    }
    var sentence = CommentBank.bestPieceSentence(
      Object.assign({ title: a.title, note: input.value, skill: skill }, CommentBank.studentRef(st)),
    )
      .replace(/\u201C/g, '\u2018')
      .replace(/\u201D/g, '\u2019');
    var typed = String(input.value || '').trim();
    var off = !!typed && !(window.CommentLint && CommentLint.startsPastTense(typed));
    preview.textContent = '';
    preview.appendChild(document.createElement('span')).textContent =
      'The comment will read: \u201C' + sentence + '\u201D ';
    if (off) {
      var hint = preview.appendChild(document.createElement('span'));
      hint.className = 'grader-report-note-hint';
      hint.textContent = _REPORT_NOTE_HINT;
    }
    preview.classList.toggle('warn', off);
  }

  function _saveReportNote(input) {
    var cid = pageState.activeCourse;
    var sid = input.dataset.sid;
    var aid = input.dataset.aid;
    if (!cid || !sid || !aid || input.disabled) return;
    Grader.setReportNote(cid, sid, aid, input.value);
    input.value = getScoreReportNote(cid, sid, aid);
    _reportNotePreview(input);
  }

  // The assessment's grade for the student, in words, and the colour its
  // capsule takes: a level's own colour, Complete green, Incomplete and
  // Missing red, points dark, Excused and ungraded grey.
  function _graderGrade(cid, a, sid) {
    var cell = assessmentCellValue(cid, sid, a);
    if (cell.kind === 'status')
      return cell.status === 'NS' ? { text: 'Missing', tone: 'l1' } : { text: 'Excused', tone: 'muted' };
    if (cell.kind === 'complete')
      return cell.mark === 'complete' ? { text: 'Complete', tone: 'l3' } : { text: 'Incomplete', tone: 'l1' };
    if (cell.kind === 'level') {
      var lv = Math.max(1, Math.min(4, cell.level));
      return { text: PROF_LABELS[lv] + ' (' + cell.text + ')', tone: 'l' + lv };
    }
    if (cell.kind === 'points') return { text: cell.text + ' of ' + (a.maxPoints || 100), tone: 'ink' };
    return { text: 'Not Graded', tone: 'muted' };
  }

  // The assessment a grading control belongs to: the card it sits in, in
  // the dialog or open on the Assignments page for one student.
  function _graderAid(el) {
    var card = el && el.closest ? el.closest('.assess-card') : null;
    if (card && card.id.indexOf('ac-') === 0) return card.id.slice(3);
    return pageState._grader ? pageState._grader.aid : null;
  }
  function _graderRoot(aid) {
    return pageState._grader ? pageState._grader.overlay : document.getElementById('ac-' + aid);
  }
  function _graderCriterion(aid, critId) {
    return aid ? getRubricCriterion(aid, critId) : null;
  }
  /* Picking the chosen level again clears it; another level replaces it
     and drops any + or −. */
  function _graderSetLevel(aid, critId, level) {
    if (!aid || !pageState.focusStudentId) return;
    var crit = _graderCriterion(aid, critId);
    if (!crit) return;
    // On a Six-Point rubric `level` is the score, 1 to 6.
    if (_sixRubricOf(pageState.activeCourse, aid)) {
      if (!RubricScale.isKey(_sixRubricOf(pageState.activeCourse, aid), level)) return;
      var nowSix = _sixScoreNow(pageState.activeCourse, pageState.focusStudentId, aid, crit);
      var nextSix = nowSix === level ? 0 : level;
      if (nextSix && isScoreLocked(pageState.activeCourse, pageState.focusStudentId, aid)) return;
      var beforeSix = nextSix ? null : structuredClone(getScores(pageState.activeCourse));
      _writeSixScore(pageState.activeCourse, pageState.focusStudentId, aid, crit, nextSix);
      refreshSidebarGrades(pageState.focusStudentId);
      render();
      _focusGraderCard(aid, '.grdt-crit[data-critid="' + critId + '"]');
      if (beforeSix) _offerClearUndo(pageState.activeCourse, beforeSix);
      return;
    }
    var state = _criterionState(pageState.activeCourse, pageState.focusStudentId, aid, crit);
    var next = state.level === level && !state.mixed ? 0 : level;
    var before = next ? null : structuredClone(getScores(pageState.activeCourse));
    rubricCriterionScoreKeys(crit).forEach(function (tid) {
      Grader.setLevel(pageState.activeCourse, pageState.focusStudentId, aid, tid, next, 0);
    });
    refreshSidebarGrades(pageState.focusStudentId);
    render();
    _focusGraderCard(aid, '.grdt-crit[data-critid="' + critId + '"]');
    if (before) _offerClearUndo(pageState.activeCourse, before);
  }
  function _graderSetMod(aid, critId, mod) {
    if (!aid || !pageState.focusStudentId) return;
    if (_sixRubricOf(pageState.activeCourse, aid)) return;
    var crit = _graderCriterion(aid, critId);
    if (!crit) return;
    var state = _criterionState(pageState.activeCourse, pageState.focusStudentId, aid, crit);
    if (!state.level) return;
    var next = state.mod === mod ? 0 : mod;
    if (normalizeScoreMod(state.level, next) !== next) return;
    rubricCriterionScoreKeys(crit).forEach(function (tid) {
      Grader.setPlusMinus(pageState.activeCourse, pageState.focusStudentId, aid, tid, state.level, next);
    });
    refreshSidebarGrades(pageState.focusStudentId);
    render();
    _focusGraderCard(aid, '.grdt-crit[data-critid="' + critId + '"]');
  }
  /* A rubric row's Checklist or Comment chip opens or closes what folds
     under it; the checklist keeps the Assignments page's Show | Hide rule. */
  function _graderToggleRow(aid, critId, what) {
    if (!aid || !pageState.focusStudentId) return;
    var key = _checklistKey(aid, pageState.focusStudentId, critId);
    var opened;
    if (what === 'checks') {
      var open = _isChecklistOpen(aid, pageState.focusStudentId, critId);
      var set = _checklistMode() === 'show' ? _closedChecklists : _openChecklists;
      if (open === (set === _closedChecklists)) set.add(key);
      else set.delete(key);
      opened = !open;
    } else {
      opened = !_graderNotesOpen.has(key);
      if (opened) _graderNotesOpen.add(key);
      else _graderNotesOpen.delete(key);
    }
    render();
    var root = _graderRoot(aid);
    var card = root && root.querySelector('.grdt-crit[data-critid="' + critId + '"]');
    if (!card) return;
    var to =
      what === 'note' && opened
        ? card.querySelector('textarea.grdt-note')
        : card.querySelector(what === 'checks' ? '[data-action="graderChecks"]' : '[data-action="graderNote"]');
    if (to) to.focus({ preventScroll: true });
  }
  /* A tick saves the box and, like the Assignments checklist, moves the
     level to the one the boxes suggest unless the teacher picked another. */
  function _graderTick(aid, critId, checkId, on) {
    if (!aid || !pageState.focusStudentId) return;
    var cid = pageState.activeCourse;
    var crit = _graderCriterion(aid, critId);
    if (!crit) return;
    // Missing and Excused work takes no score (isScoreLocked): redraw the box as saved.
    if (on && isScoreLocked(cid, pageState.focusStudentId, aid)) {
      render();
      return;
    }
    var before = getRubricCheckIds(cid, pageState.focusStudentId, aid);
    var after = Grader.setTick(cid, pageState.focusStudentId, aid, checkId, on);
    if (_sixRubricOf(cid, aid)) {
      var nowSix = _sixScoreNow(cid, pageState.focusStudentId, aid, crit);
      var nextSix = RubricChecks.levelAfterTick(crit, nowSix, before, after);
      if (nextSix !== nowSix) _writeSixScore(cid, pageState.focusStudentId, aid, crit, nextSix);
    } else {
      var current = _criterionLevelNow(cid, aid, pageState.focusStudentId, crit);
      var next = RubricChecks.levelAfterTick(crit, current, before, after);
      if (next !== current)
        rubricCriterionScoreKeys(crit).forEach(function (tid) {
          Grader.setLevel(cid, pageState.focusStudentId, aid, tid, next);
        });
    }
    refreshSidebarGrades(pageState.focusStudentId);
    render();
    var root = _graderRoot(aid);
    var box = root && root.querySelector('.grdt-check input[data-checkid="' + checkId + '"]');
    if (box) box.focus({ preventScroll: true });
  }
  function _graderSetTagLevel(aid, tagId, level) {
    if (!aid || !pageState.focusStudentId) return;
    var state = _tagState(pageState.activeCourse, pageState.focusStudentId, aid, tagId);
    var next = state.level === level && !state.mixed ? 0 : level;
    var before = next ? null : structuredClone(getScores(pageState.activeCourse));
    _tagScoreKeys(pageState.activeCourse, aid, tagId).forEach(function (key) {
      Grader.setLevel(pageState.activeCourse, pageState.focusStudentId, aid, key, next, 0);
    });
    refreshSidebarGrades(pageState.focusStudentId);
    render();
    _focusGraderCard(aid, '.grdl-card[data-tag="' + tagId + '"]');
    if (before) _offerClearUndo(pageState.activeCourse, before);
  }
  function _graderSetTagMod(aid, tagId, mod) {
    if (!aid || !pageState.focusStudentId) return;
    var state = _tagState(pageState.activeCourse, pageState.focusStudentId, aid, tagId);
    if (!state.level || state.mixed) return;
    var next = state.mod === mod ? 0 : mod;
    if (normalizeScoreMod(state.level, next) !== next) return;
    _tagScoreKeys(pageState.activeCourse, aid, tagId).forEach(function (key) {
      Grader.setPlusMinus(pageState.activeCourse, pageState.focusStudentId, aid, key, state.level, next);
    });
    refreshSidebarGrades(pageState.focusStudentId);
    render();
    _focusGraderCard(aid, '.grdl-card[data-tag="' + tagId + '"]');
  }
  // Saves typed points the way the Assignments ledger does: blank clears, a
  // typed 0 is a score, a typo puts the saved score back, leaving an
  // unchanged box saves nothing.
  function _graderCommitPoints(inp, next) {
    var aid = _graderAid(inp);
    if (!aid || !pageState.focusStudentId) return;
    var cid = pageState.activeCourse;
    var max = parseFloat(inp.dataset.max) || 100;
    var prev = getPointsScore(cid, pageState.focusStudentId, aid);
    var over = _pointsOverLimit(inp.value, max);
    var raw = parsePointsInput(inp.value, max, prev);
    if (raw === prev) {
      inp.value = raw != null ? formatPoints(raw) : '';
      return;
    }
    // One save, through Grader.setPoints, as the ledger, gradebook and phone
    // do. A second write under the assessment's own id left an entry later
    // edits elsewhere never updated, so the cell and course % kept the old
    // points.
    var sid = pageState.focusStudentId;
    Grader.setPoints(cid, pageState.focusStudentId, aid, raw);
    refreshSidebarGrades(sid);
    var nextId = next && pageState._grader && pageState._grader.overlay.contains(next) ? next.id : '';
    render();
    if (over != null) _sayPointsCapped(cid, sid, aid, over, raw, max, prev);
    // The redraw replaced the control Tab (or a click) was moving to, such
    // as Overall Comment, so focus would fall to the page: give it to the
    // new one.
    if (nextId) {
      var refocus = function () {
        var active = document.activeElement;
        if (active && active !== document.body && active.isConnected) return;
        var again = document.getElementById(nextId);
        if (again && pageState._grader && pageState._grader.overlay.contains(again))
          again.focus({ preventScroll: true });
      };
      refocus();
      setTimeout(refocus, 0);
    }
  }
  // A redraw keeps keyboard scoring on the same card.
  function _focusGraderCard(aid, selector) {
    var root = _graderRoot(aid);
    var card = root && root.querySelector(selector);
    var active = document.activeElement;
    var lost = !active || active === document.body || active.classList.contains('grader-dialog');
    if (card && lost) card.focus({ preventScroll: true });
  }

  // Most grading controls save without redrawing, so the status, comments
  // and grade are brought up to date after each one.
  function _graderAfterEvent() {
    setTimeout(_refreshGraderChrome, 0);
  }

  function closeGrader() {
    if (!pageState._grader) return;
    // A field being typed in saves on blur, so finish it before closing.
    var active = document.activeElement;
    if (active && pageState._grader.overlay.contains(active) && active.blur) active.blur();
    var g = pageState._grader;
    _graderReleasePage(g);
    pageState._grader = null;
    // Mark Up opened from this dialog goes with it.
    if (window.MarkUp && MarkUp.isOpen()) MarkUp.close();
    _hideChipTip();
    pageState._listeners.forEach(function (l) {
      document.removeEventListener(l.type, l.handler, l.options);
    });
    pageState._listeners = [];
    if (g.pageListeners) {
      g.pageListeners.forEach(function (l) {
        _addDocListener(l.type, l.handler, l.options);
      });
    }
    Object.keys(pageState._statusDebounce).forEach(function (k) {
      delete pageState._statusDebounce[k];
    });
    ['rubric-modal', 'comment-popover-overlay'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.remove();
    });
    if (pageState._commentCapture) pageState._commentCapture.destroy();
    pageState._commentCapture = null;
    CritComment.drop();
    pageState._kbFocusEl = null;
    // The student it ended on, so the gradebook selects their cell.
    var lastSid = pageState.focusStudentId;
    pageState.focusStudentId = null;
    // The page under the dialog is as it was, and has not seen what was graded.
    if (g.page) {
      pageState.openAssessIds = g.page.open;
      pageState.focusStudentId = g.page.focus;
      pageState._allExpanded = g.page.expanded;
      pageState._collapsedIds = g.page.collapsed;
      pageState.rubricViewStates = g.page.rubricViews;
      pageState._pageBehind = true;
    }
    g.overlay.remove();
    if (g.onClose) g.onClose(lastSid);
  }

  /* ── init / destroy ─────────────────────────────────────── */
  function init(params) {
    // Reset all state
    pageState.activeCourse = (params && params.course) || getActiveCourse();
    setActiveCourse(pageState.activeCourse);
    // What Class Results' buttons do here: Grade This Assessment opens the
    // card's grading list (or goes to it when open); a change redraws.
    if (window.ClassResults)
      ClassResults.setPage(function () {
        return {
          grade: function (aid) {
            var card = document.getElementById('ac-' + aid);
            if (!card || !card.classList.contains('open')) toggleAssess(aid);
            card = document.getElementById('ac-' + aid);
            if (card) {
              card.scrollIntoView({ block: 'start', behavior: 'smooth' });
              var first = card.querySelector('.assess-body input, .assess-body button, .assess-body [tabindex="0"]');
              if (first) first.focus({ preventScroll: true });
            }
          },
          onChange: function () {
            clearProfCache();
            render();
          },
        };
      });
    pageState.openAssessIds = new Set();
    pageState.focusStudentParam = (params && params.student) || null;
    pageState.focusStudentId = pageState.focusStudentParam || null;
    pageState._allExpanded = !(params && params.open && pageState.focusStudentParam);
    pageState._collapsedIds = new Set();
    pageState.filterCategories = [];
    pageState.assessSearch = '';
    pageState.showUngraded = false;
    pageState._toReturnOnly = false;
    // The dashboard's To Grade cell opens the page with To Grade on.
    AssignShow.reset(params && params.show);
    AssignList.reset();
    AssignToolbar.reset();
    pageState.rubricViewStates = {};
    pageState._showingNewForm = false;
    pageState._editingAssessId = null;
    pageState.collapsedModules = _loadClosedModules(pageState.activeCourse);
    pageState._dragAssessId = null;
    pageState._dragModuleId = null;
    pageState._mergeTargetId = null;
    pageState._mergeHoverTimer = null;
    pageState._mergeAnimating = false;
    AC.configure(pageState.activeCourse);
    _resetCollabState();
    pageState._editingRubric = null;
    pageState._rubricDirty = false;
    pageState._rubricAutoTags = [];
    pageState._commentPopoverState = null;
    CritComment.drop();
    pageState._kbFocusEl = null;
    pageState._statusDebounce = {};
    pageState._searchTimer = null;

    if (params && params.open) {
      pageState.openAssessIds = new Set([params.open]);
    }

    // Show sidebar
    document.getElementById('sidebar-mount').style.display = '';
    document.getElementById('page-layout').classList.remove('sidebar-hidden');

    // Set up sidebar with student list
    window.toggleFocusStudent = toggleFocusStudent;
    // The roster's grades are the year so far, as on the Gradebook,
    // whether the page was reached in the app or loaded fresh.
    if (typeof setActiveTerm === 'function') setActiveTerm(pageState.activeCourse, null);
    document.getElementById('sidebar-mount').innerHTML = renderSidebar(
      pageState.activeCourse,
      pageState.focusStudentId,
      'toggleFocusStudent',
    );
    initSidebarToggle();

    // Expose switchCourse globally for dock
    window._pageSwitchCourse = switchCourse;

    // Add delegated listeners
    _addDocListener('click', _handleClick);
    _addDocListener('input', _handleInput);
    _addDocListener('change', _handleChange);
    _addDocListener('focus', _handleFocus, true);
    _addDocListener('mousedown', _handleFocus);
    _addDocListener('blur', _handleBlur, true);
    _addDocListener('keydown', _handleKeydown);
    _addDocListener('dragstart', _handleDragStart);
    _addDocListener('dragend', _handleDragEnd);
    _addDocListener('dragover', _handleDragOver);
    _addDocListener('dragleave', _handleDragLeave);
    _addDocListener('drop', _handleDrop);
    _addDocListener('mouseover', _handleMouseOver);
    _addDocListener('mouseout', _handleMouseOut);
    _addDocListener('focusin', _selectDefaultName);
    _addDocListener('pointerdown', _handlePointerDown);
    _addDocListener('scroll', _hideChipTip, true);
    _addDocListener('fv:id-rekeyed', _handleRekey);
    AssignList.listen(_addDocListener);
    AssignDraft.listen(_addDocListener);
    ['click', 'change', 'focusout', 'fv:rubric-prints-changed'].forEach(function (type) {
      _addDocListener(type, _queuePrintMarks);
    });
    ['change', 'input', 'click'].forEach(function (type) {
      _addDocListener(type, _countsAsAfterEvent);
    });
    _addDocListener('keydown', _formKeydown);
    _addDocListener('input', _formInput);
    _addDocListener('change', _formInput);
    _addDocListener('keydown', _compKeydown);
    // Before _formEscape: Escape in the link row closes the row, not the form.
    _addDocListener('keydown', _formResKeydown);
    _addDocListener('keydown', _formEscape);
    _addDocListener('fv:resources-changed', _formResChanged);
    _addDocListener('input', _compInput);
    _addDocListener('mouseover', _codeHover);
    _addDocListener('focusin', _codeHover);
    _addDocListener('keydown', _startKeydown, true);
    _addDocListener('input', _startSearch);
    _addDocListener('input', _blankInput);
    if (window.RubricCommentLines) RubricCommentLines.init({ render: _blankRender, get: () => pageState._blank });
    _addDocListener('pointerdown', _blankOutside, true);
    _addDocListener('mouseover', _afTipOver);
    _addDocListener('mouseout', _afTipOut);
    _addDocListener('focusin', _afTipFocus);
    _addDocListener('focusout', _afTipBlur);
    _addDocListener('change', _afTipChange);
    _addDocListener('scroll', _afTipScroll, true);
    // Most grading here saves without a redraw: the Missing | Excused locks,
    // the Draft marks and the counts to return follow each event (S1-F2).
    // The returns part runs only in a class that holds grades.
    ['click', 'change', 'keyup', 'focusout'].forEach(function (type) {
      _addDocListener(type, _afterGradingEvent);
    });

    render();

    // "Also in …" chips read the other classes, which load after the first
    // render; draw them once those classes are here.
    if (window.RubricLibrary) {
      var warmedFor = pageState.activeCourse;
      RubricLibrary.warmCopies(pageState.activeCourse).then(function (loaded) {
        if (loaded && pageState.activeCourse === warmedFor && document.getElementById('tb-rubrics-panel')) render();
      });
    }

    // Auto-scroll to open card if arriving via ?open= param
    if (params && params.open) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          var openCard = document.querySelector('.assess-card.open');
          // The card's top, not its middle: an open card is often taller than
          // the window, and centring it hides its header.
          if (openCard) openCard.scrollIntoView({ block: 'start' });
        });
      });
    }

    // ?new=1 opens the form; ?tags= ticks those competencies in it (the Dashboard's Not Assessed names).
    if (params && params.new === '1') setTimeout(() => AssignCompPicker.openNew(showNewForm, params.tags), 100);

    // ?edit= opens that assessment in the editor (the gradebook's Edit
    // Assignment Details).
    if (params && params.edit) {
      setTimeout(function () {
        editAssess(params.edit);
      }, 100);
    }
  }

  // A new assessment or student got its server id (shared/data.js).
  function _handleRekey(e) {
    var d = e.detail || {};
    if (pageState.openAssessIds.has(d.from)) {
      pageState.openAssessIds.delete(d.from);
      pageState.openAssessIds.add(d.to);
    }
    if (pageState._editingAssessId === d.from) pageState._editingAssessId = d.to;
    if (pageState.focusStudentId === d.from) pageState.focusStudentId = d.to;
    // A new module's folder keeps its local id in the markup until the next
    // render; swap it now, or a rename before then finds no module to save.
    if (d.kind === 'module') {
      if (d.from in pageState.collapsedModules) {
        pageState.collapsedModules[d.to] = pageState.collapsedModules[d.from];
        delete pageState.collapsedModules[d.from];
        _saveClosedModules();
      }
      var from = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(d.from) : d.from;
      ['data-module-id', 'data-uid', 'data-moduleid', 'data-module-drag', 'data-folder-drop'].forEach(function (attr) {
        document.querySelectorAll('[' + attr + '="' + from + '"]').forEach(function (node) {
          node.setAttribute(attr, d.to);
        });
      });
    }
  }

  function destroy() {
    _hideChipTip();
    pageState._pageBehind = false;
    closeColorPop();
    if (window.ClassResults) ClassResults.setPage(null);
    // Remove all tracked listeners
    pageState._listeners.forEach(function (l) {
      document.removeEventListener(l.type, l.handler, l.options);
    });
    pageState._listeners = [];

    // Clear timers
    if (pageState._searchTimer) clearTimeout(pageState._searchTimer);
    if (pageState._mergeHoverTimer) clearTimeout(pageState._mergeHoverTimer);
    Object.keys(pageState._statusDebounce).forEach(function (k) {
      delete pageState._statusDebounce[k];
    });

    document.body.classList.remove('af-comp-open');

    // Clean up rubric modal (appended to body)
    var modal = document.getElementById('rubric-modal');
    if (modal) modal.remove();

    // Clean up comment popover (appended to body)
    if (pageState._commentCapture) pageState._commentCapture.destroy();
    pageState._commentCapture = null;
    var overlay = document.getElementById('comment-popover-overlay');
    if (overlay) overlay.remove();
    CritComment.drop();
    if (window.RubricPrint) RubricPrint.destroy();

    // Remove globals
    delete window._pageSwitchCourse;
    delete window.toggleFocusStudent;
  }

  // The criterion comment (teacher/crit-comment.js) borrows the class on screen,
  // four of this page's helpers and the level picked.
  CritComment.configure({
    course: () => pageState.activeCourse,
    groupRow: _groupRowFor,
    criterion: getRubricCriterion,
    scrollIntoView: _scrollIntoViewIfNeeded,
    level: (cid, sid, aid, crit) =>
      _sixRubricOf(cid, aid) ? _sixScoreNow(cid, sid, aid, crit) : _criterionState(cid, sid, aid, crit).level,
  });

  /* ── Public API ─────────────────────────────────────────── */
  return {
    init: init,
    destroy: destroy,
    render: render,
    openGrader: openGrader,
    closeGrader: closeGrader,
    askReturn: askReturn,
    graderOpen: function () {
      return !!pageState._grader;
    },
    workSurface: workSurface,
    switchCourse: switchCourse,
    toggleFocusStudent: toggleFocusStudent,
  };
})();
