/* ── page-assignments.js — Assignments page module ─────────── */
window.PageAssignments = (function () {
  'use strict';

  /* What this file holds while its page is open: every variable that is
     assigned again as the teacher works. One object, so a part of this
     file that moves to its own file can be handed it once. */
  var pageState = {};
  /* In assign-revisions.js (moved 2026-11-26). */
  var _graderRevisionAction = AssignRevisions._graderRevisionAction;
  var _graderRevisionOf = AssignRevisions._graderRevisionOf;
  var _graderRevisionReturnHtml = AssignRevisions._graderRevisionReturnHtml;
  var _refreshGraderRevision = AssignRevisions._refreshGraderRevision;
  var _refreshGraderWas = AssignRevisions._refreshGraderWas;
  var _revisionFirstDay = AssignRevisions._revisionFirstDay;
  var _revisionFirstSub = AssignRevisions._revisionFirstSub;
  var _revisionIn = AssignRevisions._revisionIn;
  var _revisionWhen = AssignRevisions._revisionWhen;
  /* In assign-grader-work.js (moved 2026-11-26). */
  var _drawGraderWork = AssignGraderWork._drawGraderWork;
  var _graderAddWorkFiles = AssignGraderWork._graderAddWorkFiles;
  var _graderForgetDrawn = AssignGraderWork._graderForgetDrawn;
  var _graderReleasePage = AssignGraderWork._graderReleasePage;
  var _graderShortLevels = AssignGraderWork._graderShortLevels;
  var _graderWorkAction = AssignGraderWork._graderWorkAction;
  var _graderWorkEnlarge = AssignGraderWork._graderWorkEnlarge;
  var _graderWorkShellHtml = AssignGraderWork._graderWorkShellHtml;
  var _graderWorkStudentChanged = AssignGraderWork._graderWorkStudentChanged;
  var _refreshGraderWorkLine = AssignGraderWork._refreshGraderWorkLine;
  var _workFitSaved = AssignGraderWork._workFitSaved;
  var _workLineText = AssignGraderWork._workLineText;
  var _workShortName = AssignGraderWork._workShortName;
  var _workStudent = AssignGraderWork._workStudent;
  var _workSubOf = AssignGraderWork._workSubOf;
  var workSurface = AssignGraderWork.workSurface;
  /* In assign-returns.js (moved 2026-11-26). */
  var _SHOW_LABELS = AssignReturns._SHOW_LABELS;
  var _askReturnDrafts = AssignReturns._askReturnDrafts;
  var _drawnReturn = AssignReturns._drawnReturn;
  var _graderReturn = AssignReturns._graderReturn;
  var _graderReturnAll = AssignReturns._graderReturnAll;
  var _graderReturnNext = AssignReturns._graderReturnNext;
  var _graderSetShow = AssignReturns._graderSetShow;
  var _graderShowOn = AssignReturns._graderShowOn;
  var _graderShowWanted = AssignReturns._graderShowWanted;
  var _graderStepShown = AssignReturns._graderStepShown;
  var _graderStops = AssignReturns._graderStops;
  var _holdsGrades = AssignReturns._holdsGrades;
  var _inlineReturnRowHtml = AssignReturns._inlineReturnRowHtml;
  var _nextShownStop = AssignReturns._nextShownStop;
  var _refreshGraderReturn = AssignReturns._refreshGraderReturn;
  var _refreshGraderShow = AssignReturns._refreshGraderShow;
  var _returnChipsHtml = AssignReturns._returnChipsHtml;
  var _returnDrafts = AssignReturns._returnDrafts;
  var _returnDraftsButtonHtml = AssignReturns._returnDraftsButtonHtml;
  var _returnMarkHtml = AssignReturns._returnMarkHtml;
  var _returnOne = AssignReturns._returnOne;
  var _returnShownIds = AssignReturns._returnShownIds;
  var _returnsAfterEvent = AssignReturns._returnsAfterEvent;
  var _seedReturns = AssignReturns._seedReturns;
  var _stopShown = AssignReturns._stopShown;
  var _studentPageOn = AssignReturns._studentPageOn;
  /* In assign-grader-notes.js (moved 2026-11-26). */
  var _graderAfterEvent = AssignGraderNotes._graderAfterEvent;
  var _graderAid = AssignGraderNotes._graderAid;
  var _graderCommitPoints = AssignGraderNotes._graderCommitPoints;
  var _graderCriterion = AssignGraderNotes._graderCriterion;
  var _graderGrade = AssignGraderNotes._graderGrade;
  var _graderReflectAction = AssignGraderNotes._graderReflectAction;
  var _graderRoot = AssignGraderNotes._graderRoot;
  var _graderSetLevel = AssignGraderNotes._graderSetLevel;
  var _graderSetMod = AssignGraderNotes._graderSetMod;
  var _graderSetTagLevel = AssignGraderNotes._graderSetTagLevel;
  var _graderSetTagMod = AssignGraderNotes._graderSetTagMod;
  var _graderTick = AssignGraderNotes._graderTick;
  var _graderToggleRow = AssignGraderNotes._graderToggleRow;
  var _refreshGraderReflection = AssignGraderNotes._refreshGraderReflection;
  var _refreshReportNote = AssignGraderNotes._refreshReportNote;
  var _reportNotePreview = AssignGraderNotes._reportNotePreview;
  var _saveReportNote = AssignGraderNotes._saveReportNote;
  var closeGrader = AssignGraderNotes.closeGrader;
  /* In assign-grader-queue.js (moved 2026-11-26). */
  var _attachLinkAdd = AssignGraderQueue._attachLinkAdd;
  var _attachLinkKeydown = AssignGraderQueue._attachLinkKeydown;
  var _attachMenuOpen = AssignGraderQueue._attachMenuOpen;
  var _attachWorkFiles = AssignGraderQueue._attachWorkFiles;
  var _cardMoreMenuHtml = AssignGraderQueue._cardMoreMenuHtml;
  var _closeAttachLink = AssignGraderQueue._closeAttachLink;
  var _gradeSubmissionsHtml = AssignGraderQueue._gradeSubmissionsHtml;
  var _inlineWorkHtml = AssignGraderQueue._inlineWorkHtml;
  var _openAttachLink = AssignGraderQueue._openAttachLink;
  var _openGraderOnWork = AssignGraderQueue._openGraderOnWork;
  var _workIconHtml = AssignGraderQueue._workIconHtml;
  var copyAssessToClass = AssignGraderQueue.copyAssessToClass;
  /* In assign-grader-parts.js (moved 2026-11-26). */
  var _GRADER_MORE_ICON = AssignGraderParts._GRADER_MORE_ICON;
  var _NOT_SCORED_ICON = AssignGraderParts._NOT_SCORED_ICON;
  var _afterGradingEvent = AssignGraderParts._afterGradingEvent;
  var _confirmBackToGroupGrade = AssignGraderParts._confirmBackToGroupGrade;
  var _drawGraderHead = AssignGraderParts._drawGraderHead;
  var _drawGraderPanel = AssignGraderParts._drawGraderPanel;
  var _drawGraderToolbar = AssignGraderParts._drawGraderToolbar;
  var _graderCaughtReturn = AssignGraderParts._graderCaughtReturn;
  var _graderFootHtml = AssignGraderParts._graderFootHtml;
  var _graderGroupAction = AssignGraderParts._graderGroupAction;
  var _graderGroupView = AssignGraderParts._graderGroupView;
  var _graderHeadHtml = AssignGraderParts._graderHeadHtml;
  var _graderHideCaughtUp = AssignGraderParts._graderHideCaughtUp;
  var _graderPanelHtml = AssignGraderParts._graderPanelHtml;
  var _graderPart = AssignGraderParts._graderPart;
  var _graderQueueOf = AssignGraderParts._graderQueueOf;
  var _graderQueueStep = AssignGraderParts._graderQueueStep;
  var _graderShellHtml = AssignGraderParts._graderShellHtml;
  var _graderStatusButtons = AssignGraderParts._graderStatusButtons;
  var _graderStepGroup = AssignGraderParts._graderStepGroup;
  var _graderSteps = AssignGraderParts._graderSteps;
  var _graderToolbarHtml = AssignGraderParts._graderToolbarHtml;
  var _graderUnits = AssignGraderParts._graderUnits;
  var _gradingScope = AssignGraderParts._gradingScope;
  var _inlineGraderHtml = AssignGraderParts._inlineGraderHtml;
  var _refreshGraderChrome = AssignGraderParts._refreshGraderChrome;
  var _statusLockAttrs = AssignGraderParts._statusLockAttrs;
  var _syncStatusLocks = AssignGraderParts._syncStatusLocks;
  var _unitIds = AssignGraderParts._unitIds;
  var askReturn = AssignGraderParts.askReturn;
  /* In assign-grader-dialog.js (moved 2026-11-26). */
  var openGrader = AssignGraderDialog.openGrader;
  /* In assign-grader-keys.js (moved 2026-11-26). */
  var _graderCardKey = AssignGraderKeys._graderCardKey;
  var _graderKeydown = AssignGraderKeys._graderKeydown;
  var _renderGrader = AssignGraderKeys._renderGrader;
  /* In assign-comment-popover.js (moved 2026-11-26). */
  var _assignmentCommentCount = AssignCommentPopover._assignmentCommentCount;
  var cancelCommentEdit = AssignCommentPopover.cancelCommentEdit;
  var closeCommentPopover = AssignCommentPopover.closeCommentPopover;
  var deleteComment = AssignCommentPopover.deleteComment;
  var editComment = AssignCommentPopover.editComment;
  var openCommentPopover = AssignCommentPopover.openCommentPopover;
  var saveCommentEdit = AssignCommentPopover.saveCommentEdit;
  /* In assign-rubric-grading.js (moved 2026-11-26). */
  var _checklistAdvice = AssignRubricGrading._checklistAdvice;
  var _checklistKey = AssignRubricGrading._checklistKey;
  var _checklistMode = AssignRubricGrading._checklistMode;
  var _checksButtonHtml = AssignRubricGrading._checksButtonHtml;
  var _closeGroupMenus = AssignRubricGrading._closeGroupMenus;
  var _criterionLevelNow = AssignRubricGrading._criterionLevelNow;
  var _graderOverallCommentHtml = AssignRubricGrading._graderOverallCommentHtml;
  var _groupRowFor = AssignRubricGrading._groupRowFor;
  var _groupRowStudents = AssignRubricGrading._groupRowStudents;
  var _groupRows = AssignRubricGrading._groupRows;
  var _isAdvancedRubric = AssignRubricGrading._isAdvancedRubric;
  var _isChecklistOpen = AssignRubricGrading._isChecklistOpen;
  var _ledgerMembersHtml = AssignRubricGrading._ledgerMembersHtml;
  var _ledgerStatusOrNoteHtml = AssignRubricGrading._ledgerStatusOrNoteHtml;
  var _overallCommentFieldHtml = AssignRubricGrading._overallCommentFieldHtml;
  var _printMarkHtml = AssignRubricGrading._printMarkHtml;
  var _queueOverallComment = AssignRubricGrading._queueOverallComment;
  var _queuePrintMarks = AssignRubricGrading._queuePrintMarks;
  var _refreshChecklistRow = AssignRubricGrading._refreshChecklistRow;
  var _rowFillOptionsHtml = AssignRubricGrading._rowFillOptionsHtml;
  var _saveOverallComment = AssignRubricGrading._saveOverallComment;
  var _setEveryoneCount = AssignRubricGrading._setEveryoneCount;
  var _setEveryonePlan = AssignRubricGrading._setEveryonePlan;
  var _toggleGroupMenu = AssignRubricGrading._toggleGroupMenu;
  var confirmFillAll = AssignRubricGrading.confirmFillAll;
  var confirmFillRubricAll = AssignRubricGrading.confirmFillRubricAll;
  var fillRubricScores = AssignRubricGrading.fillRubricScores;
  var getRubricCriterion = AssignRubricGrading.getRubricCriterion;
  var renderRubricGradingView = AssignRubricGrading.renderRubricGradingView;
  var renderTagGrid = AssignRubricGrading.renderTagGrid;
  var selectRubricScore = AssignRubricGrading.selectRubricScore;
  var setChecklistMode = AssignRubricGrading.setChecklistMode;
  var tickRubricCheck = AssignRubricGrading.tickRubricCheck;
  var toggleChecklist = AssignRubricGrading.toggleChecklist;
  var updateRubricRowUI = AssignRubricGrading.updateRubricRowUI;
  /* In assign-levels.js (moved 2026-11-26). */
  var _levelInnerHtml = AssignLevels._levelInnerHtml;
  var _offerClearUndo = AssignLevels._offerClearUndo;
  var _showFillUndo = AssignLevels._showFillUndo;
  var _sixButtonsHtml = AssignLevels._sixButtonsHtml;
  var _sixChecklistAdvice = AssignLevels._sixChecklistAdvice;
  var _sixChecklistColsHtml = AssignLevels._sixChecklistColsHtml;
  var _sixCriterionRowHtml = AssignLevels._sixCriterionRowHtml;
  var _sixRubricOf = AssignLevels._sixRubricOf;
  var _sixScoreNow = AssignLevels._sixScoreNow;
  var _syncTagRows = AssignLevels._syncTagRows;
  var _writeSixScore = AssignLevels._writeSixScore;
  var closeMenus = AssignLevels.closeMenus;
  var fillScores = AssignLevels.fillScores;
  var rowScoreState = AssignLevels.rowScoreState;
  var selectSixScore = AssignLevels.selectSixScore;
  var selectTagLevel = AssignLevels.selectTagLevel;
  var setScoreMod = AssignLevels.setScoreMod;
  var syncModRow = AssignLevels.syncModRow;
  var syncModRows = AssignLevels.syncModRows;
  var toggleScoreMenu = AssignLevels.toggleScoreMenu;
  /* In assign-ledger.js (moved 2026-11-26). */
  var _CLASS_RESULTS_ICON = AssignLedger._CLASS_RESULTS_ICON;
  var _pointsOverLimit = AssignLedger._pointsOverLimit;
  var _refreshClassResultsSoon = AssignLedger._refreshClassResultsSoon;
  var _sayPointsCapped = AssignLedger._sayPointsCapped;
  var commitPointsScore = AssignLedger.commitPointsScore;
  var confirmFillCompletion = AssignLedger.confirmFillCompletion;
  var confirmFillNotSubmitted = AssignLedger.confirmFillNotSubmitted;
  var confirmFillPoints = AssignLedger.confirmFillPoints;
  var handleLedgerKey = AssignLedger.handleLedgerKey;
  var handlePointsKey = AssignLedger.handlePointsKey;
  var ledgerStatusHtml = AssignLedger.ledgerStatusHtml;
  var livePointsUpdate = AssignLedger.livePointsUpdate;
  var refreshLedgerSummary = AssignLedger.refreshLedgerSummary;
  var renderCompletionGrid = AssignLedger.renderCompletionGrid;
  var renderPointsGrid = AssignLedger.renderPointsGrid;
  var setCompletion = AssignLedger.setCompletion;
  var toggleStudentStatus = AssignLedger.toggleStudentStatus;
  /* In assign-dibels.js (moved 2026-11-26). */
  var _cardBodyHtml = AssignDibels._cardBodyHtml;
  var _cardOpen = AssignDibels._cardOpen;
  var _commitDibelsField = AssignDibels._commitDibelsField;
  var _completeCardHtml = AssignDibels._completeCardHtml;
  var _dibelsCardHtml = AssignDibels._dibelsCardHtml;
  var _dibelsGridHtml = AssignDibels._dibelsGridHtml;
  var _dibelsLevelPillsHtml = AssignDibels._dibelsLevelPillsHtml;
  var _graderPickHtml = AssignDibels._graderPickHtml;
  var _levelCardsHtml = AssignDibels._levelCardsHtml;
  var _loadDibelsOnce = AssignDibels._loadDibelsOnce;
  var _newFormHtml = AssignDibels._newFormHtml;
  var _pointsCardHtml = AssignDibels._pointsCardHtml;
  var _refreshCardCounts = AssignDibels._refreshCardCounts;
  var _setHas = AssignDibels._setHas;
  var _setTagScore = AssignDibels._setTagScore;
  var _tagScoreKeys = AssignDibels._tagScoreKeys;
  var _tagState = AssignDibels._tagState;
  var printDibels = AssignDibels.printDibels;
  var renderAssessmentList = AssignDibels.renderAssessmentList;
  var setDibelsPeriod = AssignDibels.setDibelsPeriod;
  /* In assign-inputs.js (moved 2026-11-26). */
  var _handleBlur = AssignInputs._handleBlur;
  var _handleChange = AssignInputs._handleChange;
  var _handleFocus = AssignInputs._handleFocus;
  var _handleInput = AssignInputs._handleInput;
  /* In assign-drag-events.js (moved 2026-11-26). */
  var _handleDragEnd = AssignDragEvents._handleDragEnd;
  var _handleDragLeave = AssignDragEvents._handleDragLeave;
  var _handleDragOver = AssignDragEvents._handleDragOver;
  var _handleDragStart = AssignDragEvents._handleDragStart;
  var _handleDrop = AssignDragEvents._handleDrop;
  var _handleMouseOut = AssignDragEvents._handleMouseOut;
  var _handleMouseOver = AssignDragEvents._handleMouseOver;
  var _handlePointerDown = AssignDragEvents._handlePointerDown;
  var _selectDefaultName = AssignDragEvents._selectDefaultName;
  /* In assign-card-open.js (moved 2026-11-26). */
  var _expandSegOn = AssignCardOpen._expandSegOn;
  var collapseAllAssess = AssignCardOpen.collapseAllAssess;
  var expandAllAssess = AssignCardOpen.expandAllAssess;
  var kbFocusCell = AssignCardOpen.kbFocusCell;
  var navigateKb = AssignCardOpen.navigateKb;
  var setRubricView = AssignCardOpen.setRubricView;
  var toggleAssess = AssignCardOpen.toggleAssess;
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
  AssignCardOpen.configure({
    pageState: pageState,
    _cardBodyHtml: _cardBodyHtml,
    _cardOpen: _cardOpen,
    _refreshCardCounts: _refreshCardCounts,
    _afterCardsDrawn: _afterCardsDrawn,
    _hideAfTip: _hideAfTip,
    _hideChipTip: _hideChipTip,
    _scrollIntoViewIfNeeded: _scrollIntoViewIfNeeded,
    _toolbarState: _toolbarState,
    render: render,
  });
  AssignDragEvents.configure({
    pageState: pageState,
    collabDragStart: collabDragStart,
    collabDrop: collabDrop,
    _canStack: _canStack,
    _clearDropMarker: _clearDropMarker,
    _clearMergeState: _clearMergeState,
    _hasNameTip: _hasNameTip,
    _hideChipTip: _hideChipTip,
    _queueNameTip: _queueNameTip,
    _setDropMarker: _setDropMarker,
    _showChipTip: _showChipTip,
    mergeToNewModule: mergeToNewModule,
    onAssessDragEnd: onAssessDragEnd,
    onAssessDragStart: onAssessDragStart,
    onFolderDrop: onFolderDrop,
    onModuleDragEnd: onModuleDragEnd,
    onModuleDragStart: onModuleDragStart,
    onModuleDropZoneDrop: onModuleDropZoneDrop,
    reorderAssessment: reorderAssessment,
  });
  AssignInputs.configure({
    pageState: pageState,
    _attachWorkFiles: _attachWorkFiles,
    _commitDibelsField: _commitDibelsField,
    _graderAid: _graderAid,
    _graderCommitPoints: _graderCommitPoints,
    _graderCriterion: _graderCriterion,
    _queueOverallComment: _queueOverallComment,
    _saveOverallComment: _saveOverallComment,
    collabToggleStudent: collabToggleStudent,
    commitPointsScore: commitPointsScore,
    getRubricCriterion: getRubricCriterion,
    livePointsUpdate: livePointsUpdate,
    switchCourse: switchCourse,
    _copyFromChanged: _copyFromChanged,
    _formResFiles: _formResFiles,
    _hideChipTip: _hideChipTip,
    _setFormWorkUntil: _setFormWorkUntil,
    _setModuleDraggable: _setModuleDraggable,
    _showChipTip: _showChipTip,
    _syncCodes: _syncCodes,
    _tickGroup: _tickGroup,
    autoSetDueDate: autoSetDueDate,
    onRubricSelect: onRubricSelect,
    onTagChange: onTagChange,
    setAssessSearch: setAssessSearch,
    updateModuleName: updateModuleName,
  });
  AssignDibels.configure({
    pageState: pageState,
    _cardMoreMenuHtml: _cardMoreMenuHtml,
    _drawnReturn: _drawnReturn,
    _gradeSubmissionsHtml: _gradeSubmissionsHtml,
    _graderStatusButtons: _graderStatusButtons,
    _groupRowStudents: _groupRowStudents,
    _holdsGrades: _holdsGrades,
    _inlineGraderHtml: _inlineGraderHtml,
    _returnChipsHtml: _returnChipsHtml,
    _returnDraftsButtonHtml: _returnDraftsButtonHtml,
    _CHEVRON_ICON: _CHEVRON_ICON,
    _MODULE_CHEVRON: _MODULE_CHEVRON,
    _MODULE_TRASH: _MODULE_TRASH,
    _RUBRIC_ICON: _RUBRIC_ICON,
    _WARNING_ICON: _WARNING_ICON,
    _cardHas: _cardHas,
    _cardScoringBadges: _cardScoringBadges,
    _categoryChipTip: _categoryChipTip,
    _chipTipAttrs: _chipTipAttrs,
    _getAssessmentCategoryId: _getAssessmentCategoryId,
    _getCategoryName: _getCategoryName,
    _graderHtml: _graderHtml,
    _newQuizBtn: _newQuizBtn,
    _scoreTagObjs: _scoreTagObjs,
    render: render,
    renderAssessForm: renderAssessForm,
  });
  AssignLedger.configure({
    pageState: pageState,
    _assignmentCommentCount: _assignmentCommentCount,
    _groupRowFor: _groupRowFor,
    _ledgerMembersHtml: _ledgerMembersHtml,
    _ledgerStatusOrNoteHtml: _ledgerStatusOrNoteHtml,
    _overallCommentFieldHtml: _overallCommentFieldHtml,
    _returnMarkHtml: _returnMarkHtml,
    _showFillUndo: _showFillUndo,
    _statusLockAttrs: _statusLockAttrs,
    _workIconHtml: _workIconHtml,
    syncModRow: syncModRow,
    render: render,
  });
  AssignLevels.configure({
    pageState: pageState,
    _checksButtonHtml: _checksButtonHtml,
    _isAdvancedRubric: _isAdvancedRubric,
    _isChecklistOpen: _isChecklistOpen,
    _refreshChecklistRow: _refreshChecklistRow,
    _setEveryoneCount: _setEveryoneCount,
    _setEveryonePlan: _setEveryonePlan,
    getRubricCriterion: getRubricCriterion,
    updateRubricRowUI: updateRubricRowUI,
    _criterionState: _criterionState,
    _setTagScore: _setTagScore,
    _tagScoreKeys: _tagScoreKeys,
    _tagState: _tagState,
    render: render,
  });
  AssignRubricGrading.configure({
    pageState: pageState,
    _graderStatusButtons: _graderStatusButtons,
    _graderUnits: _graderUnits,
    _gradingScope: _gradingScope,
    _returnMarkHtml: _returnMarkHtml,
    _returnsAfterEvent: _returnsAfterEvent,
    _syncStatusLocks: _syncStatusLocks,
    _unitIds: _unitIds,
    _workIconHtml: _workIconHtml,
    _levelInnerHtml: _levelInnerHtml,
    _offerClearUndo: _offerClearUndo,
    _showFillUndo: _showFillUndo,
    _sixCriterionRowHtml: _sixCriterionRowHtml,
    _sixRubricOf: _sixRubricOf,
    _sixScoreNow: _sixScoreNow,
    _syncTagRows: _syncTagRows,
    _tagState: _tagState,
    _writeSixScore: _writeSixScore,
    fillScores: fillScores,
    kbFocusCell: kbFocusCell,
    ledgerStatusHtml: ledgerStatusHtml,
    render: render,
    rowScoreState: rowScoreState,
    syncModRow: syncModRow,
    syncModRows: syncModRows,
  });
  AssignCommentPopover.configure({ pageState: pageState });
  AssignGraderKeys.configure({
    pageState: pageState,
    _drawGraderHead: _drawGraderHead,
    _drawGraderPanel: _drawGraderPanel,
    _drawGraderToolbar: _drawGraderToolbar,
    _drawGraderWork: _drawGraderWork,
    _graderAid: _graderAid,
    _graderForgetDrawn: _graderForgetDrawn,
    _graderGroupView: _graderGroupView,
    _graderPart: _graderPart,
    _graderReturnNext: _graderReturnNext,
    _graderRoot: _graderRoot,
    _graderSetLevel: _graderSetLevel,
    _graderSetMod: _graderSetMod,
    _graderSetTagLevel: _graderSetTagLevel,
    _graderSetTagMod: _graderSetTagMod,
    _graderShellHtml: _graderShellHtml,
    _graderWorkShellHtml: _graderWorkShellHtml,
    _graderWorkStudentChanged: _graderWorkStudentChanged,
    _refreshGraderChrome: _refreshGraderChrome,
    _refreshGraderReflection: _refreshGraderReflection,
    closeGrader: closeGrader,
    _focusGraderPoints: _focusGraderPoints,
    _scrollIntoViewIfNeeded: _scrollIntoViewIfNeeded,
    stepFocusStudent: stepFocusStudent,
  });
  AssignGraderDialog.configure({
    pageState: pageState,
    _addDocListener: _addDocListener,
    _graderAddWorkFiles: _graderAddWorkFiles,
    _graderAfterEvent: _graderAfterEvent,
    _graderCaughtReturn: _graderCaughtReturn,
    _graderGroupAction: _graderGroupAction,
    _graderQueueOf: _graderQueueOf,
    _graderReflectAction: _graderReflectAction,
    _graderReturn: _graderReturn,
    _graderReturnAll: _graderReturnAll,
    _graderReturnNext: _graderReturnNext,
    _graderRevisionAction: _graderRevisionAction,
    _graderSetShow: _graderSetShow,
    _graderWorkAction: _graderWorkAction,
    _graderWorkEnlarge: _graderWorkEnlarge,
    _handleClick: _handleClick,
    _handleKeydown: _handleKeydown,
    _refreshGraderChrome: _refreshGraderChrome,
    _reportNotePreview: _reportNotePreview,
    _saveReportNote: _saveReportNote,
    _workFitSaved: _workFitSaved,
    closeGrader: closeGrader,
    _focusGraderPoints: _focusGraderPoints,
    _graderKeydown: _graderKeydown,
    _handleBlur: _handleBlur,
    _handleChange: _handleChange,
    _handleFocus: _handleFocus,
    _handleInput: _handleInput,
    _handleMouseOut: _handleMouseOut,
    _handleMouseOver: _handleMouseOver,
    _handlePointerDown: _handlePointerDown,
    _hideChipTip: _hideChipTip,
    _loadDibelsOnce: _loadDibelsOnce,
    _queuePrintMarks: _queuePrintMarks,
    render: render,
    stepFocusStudent: stepFocusStudent,
  });
  AssignGraderParts.configure({
    pageState: pageState,
    _graderForgetDrawn: _graderForgetDrawn,
    _graderGrade: _graderGrade,
    _graderShortLevels: _graderShortLevels,
    _graderShowOn: _graderShowOn,
    _graderShowWanted: _graderShowWanted,
    _graderStops: _graderStops,
    _holdsGrades: _holdsGrades,
    _inlineReturnRowHtml: _inlineReturnRowHtml,
    _inlineWorkHtml: _inlineWorkHtml,
    _nextShownStop: _nextShownStop,
    _refreshGraderReturn: _refreshGraderReturn,
    _refreshGraderRevision: _refreshGraderRevision,
    _refreshGraderShow: _refreshGraderShow,
    _refreshGraderWas: _refreshGraderWas,
    _refreshGraderWorkLine: _refreshGraderWorkLine,
    _refreshReportNote: _refreshReportNote,
    _returnDrafts: _returnDrafts,
    _returnsAfterEvent: _returnsAfterEvent,
    _stopShown: _stopShown,
    _workFitSaved: _workFitSaved,
    _workStudent: _workStudent,
    closeGrader: closeGrader,
    _countsAsText: _countsAsText,
    _dibelsLevelPillsHtml: _dibelsLevelPillsHtml,
    _focusGraderPoints: _focusGraderPoints,
    _graderHtml: _graderHtml,
    _graderToTop: _graderToTop,
    _printMarkHtml: _printMarkHtml,
    _scoreTagObjs: _scoreTagObjs,
    render: render,
  });
  AssignGraderQueue.configure({
    pageState: pageState,
    _workLineText: _workLineText,
    _workShortName: _workShortName,
    _workStudent: _workStudent,
    _workSubOf: _workSubOf,
    RES_LINK_WORDS: RES_LINK_WORDS,
    _CLASS_RESULTS_ICON: _CLASS_RESULTS_ICON,
    _GRADER_MORE_ICON: _GRADER_MORE_ICON,
    _checklistMode: _checklistMode,
    _isAdvancedRubric: _isAdvancedRubric,
    editAssess: editAssess,
    openGrader: openGrader,
    render: render,
  });
  AssignGraderNotes.configure({
    pageState: pageState,
    _addDocListener: _addDocListener,
    _graderReleasePage: _graderReleasePage,
    _checklistKey: _checklistKey,
    _checklistMode: _checklistMode,
    _criterionLevelNow: _criterionLevelNow,
    _criterionState: _criterionState,
    _graderNotesOpen: _graderNotesOpen,
    _hideChipTip: _hideChipTip,
    _isChecklistOpen: _isChecklistOpen,
    _offerClearUndo: _offerClearUndo,
    _pointsOverLimit: _pointsOverLimit,
    _refreshGraderChrome: _refreshGraderChrome,
    _sayPointsCapped: _sayPointsCapped,
    _sixRubricOf: _sixRubricOf,
    _sixScoreNow: _sixScoreNow,
    _tagScoreKeys: _tagScoreKeys,
    _tagState: _tagState,
    _writeSixScore: _writeSixScore,
    getRubricCriterion: getRubricCriterion,
    render: render,
  });
  AssignReturns.configure({
    pageState: pageState,
    _graderRevisionReturnHtml: _graderRevisionReturnHtml,
    _graderGroupView: _graderGroupView,
    _graderSteps: _graderSteps,
    _graderToTop: _graderToTop,
    _groupRowFor: _groupRowFor,
    _refreshGraderChrome: _refreshGraderChrome,
    _returnState: _returnState,
    _setHas: _setHas,
    _unitIds: _unitIds,
    render: render,
    stepFocusStudent: stepFocusStudent,
  });
  AssignGraderWork.configure({
    pageState: pageState,
    _graderRevisionOf: _graderRevisionOf,
    _revisionFirstDay: _revisionFirstDay,
    _revisionFirstSub: _revisionFirstSub,
    _revisionIn: _revisionIn,
    _revisionWhen: _revisionWhen,
    _formWorkDemo: _formWorkDemo,
    _graderFootHtml: _graderFootHtml,
    _graderGroupView: _graderGroupView,
    _graderHeadHtml: _graderHeadHtml,
    _graderPanelHtml: _graderPanelHtml,
    _graderToTop: _graderToTop,
    _graderToolbarHtml: _graderToolbarHtml,
    _graderUnits: _graderUnits,
    _rowFillOptionsHtml: _rowFillOptionsHtml,
    _setEveryonePlan: _setEveryonePlan,
    _showFillUndo: _showFillUndo,
    _unitIds: _unitIds,
    render: render,
  });
  AssignRevisions.configure({
    pageState: pageState,
    _criterionState: _criterionState,
    _refreshGraderChrome: _refreshGraderChrome,
    _scoreTagObjs: _scoreTagObjs,
    _tagState: _tagState,
    _workStudent: _workStudent,
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
  AssignGraderNotes.configure({ _closedChecklists: _closedChecklists, _openChecklists: _openChecklists });
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
  AssignDragEvents.configure({ AC: AC });
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
  // The open panel follows the page's changes, once per frame.
  pageState._crRefreshQueued = false;
  /* A fill's Undo toast. While it is up, Cmd+Z (Ctrl+Z) outside a text
     field takes the same Undo (_handleKeydown). */
  pageState._fillUndoOpen = false;
  AssignLedger.configure({ _groupRows: _groupRows });
  // Set while the rubric view draws its Additional Tags rows.
  pageState._groupStripOff = false;

  /* ── The rubric editor window (Nov 19) ─────────────────────
     New and Edit from the Rubric Bank open the Blank Rubric card (the
     assessment form's editor) in a large window, so a rubric is built the
     same way wherever it is built. The card's state is `_blank`, with
     host 'modal'; a Blank draft open on the form waits in _formBlank. */
  pageState._formBlank = null;
  AssignBlankRubric.configure({ _RUBRIC_STYLE_NAMES: _RUBRIC_STYLE_NAMES });
  /* The comment box is the shared capture strip, with the student and the
     assessment fixed. The overlay is built once per student and assessment
     so the strip keeps its state; adding or deleting redraws the list. */
  pageState._commentCapture = null;
  /* One comment at a time is edited in place; nothing is written until Save. */
  pageState._commentEditId = null;

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

  // The last touch, so a tap's emulated mouse events are not read as a hover.
  pageState._lastTouch = 0;

  /* ── Grader dialog ───────────────────────────────────────
     The gradebook's cell editor: this page's grading controls for one
     assessment and one student, in a dialog over the gradebook. While it is
     open, render() draws the dialog instead of the page, and this page's
     listeners run alongside the gradebook's (which stand aside, see
     PageAssignments.graderOpen). */
  pageState._grader = null;
  // True from a dialog over this page closing until the page is next drawn.
  pageState._pageBehind = false;
  AssignDibels.configure({ _NOT_SCORED_ICON: _NOT_SCORED_ICON });
  AssignCards.configure({ _NOT_SCORED_ICON: _NOT_SCORED_ICON });
  AssignRubricGrading.configure({
    CHECKLIST_MODE_KEY: CHECKLIST_MODE_KEY,
    _GRADER_MORE_ICON: _GRADER_MORE_ICON,
    _closedChecklists: _closedChecklists,
    _openChecklists: _openChecklists,
  });

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
  AssignGraderDialog.configure({ AC: AC, _SHOW_LABELS: _SHOW_LABELS });

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
