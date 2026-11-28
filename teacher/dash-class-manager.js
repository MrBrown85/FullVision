/* dash-class-manager.js — Class manager + curriculum wizard (extracted from page-dashboard.js) */
window.DashClassManager = (function () {
  'use strict';

  /* What this file holds while its page is open: every variable that is
     assigned again as the teacher works. One object, so a part of this
     file that moves to its own file can be handed it once. */
  var state = {};
  /* In cm-withdrawn.js (moved 2026-11-26). */
  var _cmPhotosBeforeDelete = CmWithdrawn._cmPhotosBeforeDelete;
  var _cmWithdrawnRecordRows = CmWithdrawn._cmWithdrawnRecordRows;
  var cmDeleteWithdrawn = CmWithdrawn.cmDeleteWithdrawn;
  var cmReenrolStudent = CmWithdrawn.cmReenrolStudent;
  var renderWithdrawnList = CmWithdrawn.renderWithdrawnList;
  var withdrawStudentUI = CmWithdrawn.withdrawStudentUI;
  /* In cm-competency-cards.js (moved 2026-11-26). */
  var _cmRenderStdCard = CmCompetencyCards._cmRenderStdCard;
  var _cmStdCode = CmCompetencyCards._cmStdCode;
  var _initCmStdDrag = CmCompetencyCards._initCmStdDrag;
  var cmToggleStdCard = CmCompetencyCards.cmToggleStdCard;
  var cmToggleStdFolder = CmCompetencyCards.cmToggleStdFolder;
  /* In cm-competency-import.js (moved 2026-11-26). */
  var _cmLoose = CmCompetencyImport._cmLoose;
  var _cmNorm = CmCompetencyImport._cmNorm;
  var _cmOpenCompReview = CmCompetencyImport._cmOpenCompReview;
  var _cmRemoveMessage = CmCompetencyImport._cmRemoveMessage;
  var _cmRenderCompReview = CmCompetencyImport._cmRenderCompReview;
  var cmCompReviewApply = CmCompetencyImport.cmCompReviewApply;
  var cmCompReviewCancel = CmCompetencyImport.cmCompReviewCancel;
  var cmCompReviewPick = CmCompetencyImport.cmCompReviewPick;
  var cmCompReviewShowSame = CmCompetencyImport.cmCompReviewShowSame;
  var cmCompReviewToggle = CmCompetencyImport.cmCompReviewToggle;
  /* In cm-relink.js (moved 2026-11-26). */
  var _cmCrosswalkPairs = CmRelink._cmCrosswalkPairs;
  var cmRelinkCancel = CmRelink.cmRelinkCancel;
  var cmRelinkNext = CmRelink.cmRelinkNext;
  var cmStartRelink = CmRelink.cmStartRelink;
  var renderCmRelinkPanel = CmRelink.renderCmRelinkPanel;
  /* In cm-competency-edit.js (moved 2026-11-26). */
  var _cmCloseStdMenus = CmCompetencyEdit._cmCloseStdMenus;
  var _cmLevelsHtml = CmCompetencyEdit._cmLevelsHtml;
  var cmAddTag = CmCompetencyEdit.cmAddTag;
  var cmDeleteStd = CmCompetencyEdit.cmDeleteStd;
  var cmDeleteTag = CmCompetencyEdit.cmDeleteTag;
  var cmIcanAdd = CmCompetencyEdit.cmIcanAdd;
  var cmIcanDelete = CmCompetencyEdit.cmIcanDelete;
  var cmIcanEdit = CmCompetencyEdit.cmIcanEdit;
  var cmIcanMove = CmCompetencyEdit.cmIcanMove;
  var cmLevelsCancel = CmCompetencyEdit.cmLevelsCancel;
  var cmLevelsDraft = CmCompetencyEdit.cmLevelsDraft;
  var cmLevelsEdit = CmCompetencyEdit.cmLevelsEdit;
  var cmLevelsSave = CmCompetencyEdit.cmLevelsSave;
  var cmStdCodeLive = CmCompetencyEdit.cmStdCodeLive;
  var cmStdEditWording = CmCompetencyEdit.cmStdEditWording;
  var cmStdFinishWording = CmCompetencyEdit.cmStdFinishWording;
  var cmStdLabelLive = CmCompetencyEdit.cmStdLabelLive;
  var cmStdRestoreWording = CmCompetencyEdit.cmStdRestoreWording;
  var cmStdToggleMenu = CmCompetencyEdit.cmStdToggleMenu;
  var cmUpdateStdCode = CmCompetencyEdit.cmUpdateStdCode;
  var cmUpdateStdLabel = CmCompetencyEdit.cmUpdateStdLabel;
  var cmUpdateTagLabel = CmCompetencyEdit.cmUpdateTagLabel;
  var cmUpdateTagText = CmCompetencyEdit.cmUpdateTagText;
  /* In cm-dispatch.js (moved 2026-11-26). */
  var _cmRestoreKeptFocus = CmDispatch._cmRestoreKeptFocus;
  var handleAction = CmDispatch.handleAction;
  var handleBlur = CmDispatch.handleBlur;
  var handleChange = CmDispatch.handleChange;
  var handleInput = CmDispatch.handleInput;
  var handleKeydown = CmDispatch.handleKeydown;
  /* In cm-curriculum.js (moved 2026-11-26). */
  var _cmAttr = CmCurriculum._cmAttr;
  var _cmCompTitle = CmCurriculum._cmCompTitle;
  var _cmJoinNames = CmCurriculum._cmJoinNames;
  var _cmRenderAndFocus = CmCurriculum._cmRenderAndFocus;
  var _cmRenderCompToolbar = CmCurriculum._cmRenderCompToolbar;
  var _cmRenderStdSelectRow = CmCurriculum._cmRenderStdSelectRow;
  var _cmRenderWithScroll = CmCurriculum._cmRenderWithScroll;
  var cmAddCompGroup = CmCurriculum.cmAddCompGroup;
  var cmAddStd = CmCurriculum.cmAddStd;
  var cmAddSubject = CmCurriculum.cmAddSubject;
  var cmCompCSV = CmCurriculum.cmCompCSV;
  var cmCompExport = CmCurriculum.cmCompExport;
  var cmCompImport = CmCurriculum.cmCompImport;
  var cmCompMove = CmCurriculum.cmCompMove;
  var cmCompRemoveSelected = CmCurriculum.cmCompRemoveSelected;
  var cmCompRowsFromCsv = CmCurriculum.cmCompRowsFromCsv;
  var cmCompSelectAll = CmCurriculum.cmCompSelectAll;
  var cmCompSelectDone = CmCurriculum.cmCompSelectDone;
  var cmCompSelectStart = CmCurriculum.cmCompSelectStart;
  var cmCompToggle = CmCurriculum.cmCompToggle;
  var cmDeleteCompGroup = CmCurriculum.cmDeleteCompGroup;
  var cmDeleteSubject = CmCurriculum.cmDeleteSubject;
  var cmOpenGroupColorPop = CmCurriculum.cmOpenGroupColorPop;
  var cmPickColor = CmCurriculum.cmPickColor;
  var cmToggleColorPalette = CmCurriculum.cmToggleColorPalette;
  var cmUpdateCompGroupName = CmCurriculum.cmUpdateCompGroupName;
  var cmUpdateStdColor = CmCurriculum.cmUpdateStdColor;
  var cmUpdateStdGroup = CmCurriculum.cmUpdateStdGroup;
  var cmUpdateStdName = CmCurriculum.cmUpdateStdName;
  var cmUpdateStdSubject = CmCurriculum.cmUpdateStdSubject;
  var cmUpdateSubjectColor = CmCurriculum.cmUpdateSubjectColor;
  var cmUpdateSubjectName = CmCurriculum.cmUpdateSubjectName;
  /* In cm-class-actions.js (moved 2026-11-26). */
  var _cmDuplicateCourse = CmClassActions._cmDuplicateCourse;
  var cmDeleteCourse = CmClassActions.cmDeleteCourse;
  var cmDownloadBackup = CmClassActions.cmDownloadBackup;
  var cmDuplicateCourse = CmClassActions.cmDuplicateCourse;
  var cmRestoreBackup = CmClassActions.cmRestoreBackup;
  var cmToggleArchive = CmClassActions.cmToggleArchive;
  /* In cm-edit-actions.js (moved 2026-11-26). */
  var CM_FOLDER_COUNT_SENT = CmEditActions.CM_FOLDER_COUNT_SENT;
  var _cmCalcMethodDescription = CmEditActions._cmCalcMethodDescription;
  var _cmCatNoticeAction = CmEditActions._cmCatNoticeAction;
  var _cmCatNoticeText = CmEditActions._cmCatNoticeText;
  var _cmCatPrepare = CmEditActions._cmCatPrepare;
  var _cmCatReorder = CmEditActions._cmCatReorder;
  var _cmCatState = CmEditActions._cmCatState;
  var _cmCatTypedLine = CmEditActions._cmCatTypedLine;
  var _cmDefaultCalcMethod = CmEditActions._cmDefaultCalcMethod;
  var _cmDefaultGradingScale = CmEditActions._cmDefaultGradingScale;
  var _cmDefaultGradingSystem = CmEditActions._cmDefaultGradingSystem;
  var _cmDefaultLevelOrder = CmEditActions._cmDefaultLevelOrder;
  var _cmGradeChangeMessage = CmEditActions._cmGradeChangeMessage;
  var _cmGradingSystemDescription = CmEditActions._cmGradingSystemDescription;
  var _cmRenderCategoriesField = CmEditActions._cmRenderCategoriesField;
  var _cmRenderLevelOrderField = CmEditActions._cmRenderLevelOrderField;
  var _initCmCatDrag = CmEditActions._initCmCatDrag;
  var cmCatAdd = CmEditActions.cmCatAdd;
  var cmCatAssignUncategorized = CmEditActions.cmCatAssignUncategorized;
  var cmCatDelete = CmEditActions.cmCatDelete;
  var cmCatMode = CmEditActions.cmCatMode;
  var cmCatMoveCancel = CmEditActions.cmCatMoveCancel;
  var cmCatMoveDelete = CmEditActions.cmCatMoveDelete;
  var cmCatNameLive = CmEditActions.cmCatNameLive;
  var cmCatNoticeDone = CmEditActions.cmCatNoticeDone;
  var cmCatSave = CmEditActions.cmCatSave;
  var cmCatWeightLive = CmEditActions.cmCatWeightLive;
  var cmOpenSetupCopy = CmEditActions.cmOpenSetupCopy;
  var cmSaveDecay = CmEditActions.cmSaveDecay;
  var cmSetCalcMethod = CmEditActions.cmSetCalcMethod;
  var cmSetCoursesCountEqually = CmEditActions.cmSetCoursesCountEqually;
  var cmSetFolderCountsAsOne = CmEditActions.cmSetFolderCountsAsOne;
  var cmSetFoldersCountAsOne = CmEditActions.cmSetFoldersCountAsOne;
  var cmSetGradingSystem = CmEditActions.cmSetGradingSystem;
  var cmSetLevelOrder = CmEditActions.cmSetLevelOrder;
  var cmSetRecentLimit = CmEditActions.cmSetRecentLimit;
  var cmSetRoundPercent = CmEditActions.cmSetRoundPercent;
  var cmUpdateDecay = CmEditActions.cmUpdateDecay;
  var cmUpdateField = CmEditActions.cmUpdateField;
  /* In cm-wizard.js (moved 2026-11-26). */
  var _cwCourseCounts = CmWizard._cwCourseCounts;
  var _cwRailSync = CmWizard._cwRailSync;
  var cwCompToggle = CmWizard.cwCompToggle;
  var cwFindInput = CmWizard.cwFindInput;
  var cwFinishCreate = CmWizard.cwFinishCreate;
  var cwFolderSet = CmWizard.cwFolderSet;
  var cwGoBack = CmWizard.cwGoBack;
  var cwGoToStep2 = CmWizard.cwGoToStep2;
  var cwNameInput = CmWizard.cwNameInput;
  var cwOpenRow = CmWizard.cwOpenRow;
  var cwSelectGrade = CmWizard.cwSelectGrade;
  var cwSkipToCustom = CmWizard.cwSkipToCustom;
  var cwToggleCourse = CmWizard.cwToggleCourse;
  var cwTogglePreset = CmWizard.cwTogglePreset;
  var renderCmCreateForm = CmWizard.renderCmCreateForm;
  /* In cm-grading.js (moved 2026-11-26). */
  var CM_METHOD_TEXT = CmGrading.CM_METHOD_TEXT;
  var _cmEndedTerm = CmGrading._cmEndedTerm;
  var _cmMethodRule = CmGrading._cmMethodRule;
  var _cmRenderFoldersCountAsOne = CmGrading._cmRenderFoldersCountAsOne;
  var _cmRenderGradingTab = CmGrading._cmRenderGradingTab;
  var cmBcPointsScale = CmGrading.cmBcPointsScale;
  var cmCheckStudent = CmGrading.cmCheckStudent;
  var cmFolderCountChoice = CmGrading.cmFolderCountChoice;
  var cmMatchPointsScale = CmGrading.cmMatchPointsScale;
  var cmPtsLive = CmGrading.cmPtsLive;
  var cmResetPointsScale = CmGrading.cmResetPointsScale;
  var cmRoundPercentSelect = CmGrading.cmRoundPercentSelect;
  var cmSavePointsScale = CmGrading.cmSavePointsScale;
  /* In cm-other-classes.js (moved 2026-11-26). */
  var _cmNoteOpened = CmOtherClasses._cmNoteOpened;
  var _cmRefreshSidebar = CmOtherClasses._cmRefreshSidebar;
  var _cmShowWhenLoaded = CmOtherClasses._cmShowWhenLoaded;
  var _cmShownTabs = CmOtherClasses._cmShownTabs;
  var _cmTabShown = CmOtherClasses._cmTabShown;
  var _cwCourseRow = CmOtherClasses._cwCourseRow;
  var _cwSeg = CmOtherClasses._cwSeg;
  var _cwSetRow = CmOtherClasses._cwSetRow;
  var blockChipSelect = CmOtherClasses.blockChipSelect;
  var blockOtherInput = CmOtherClasses.blockOtherInput;
  var blockPickerHtml = CmOtherClasses.blockPickerHtml;
  var closeClassManager = CmOtherClasses.closeClassManager;
  var cmOpenDemoMode = CmOtherClasses.cmOpenDemoMode;
  var cmOpenGradebook = CmOtherClasses.cmOpenGradebook;
  var cmSetTab = CmOtherClasses.cmSetTab;
  var openClassManager = CmOtherClasses.openClassManager;
  var readBlockPicker = CmOtherClasses.readBlockPicker;
  var renderClassManager = CmOtherClasses.renderClassManager;
  /* In cm-guardians.js (moved 2026-11-26). */
  var _CM_FIELD_LABEL = CmGuardians._CM_FIELD_LABEL;
  var _cmAddGuardianEmail = CmGuardians._cmAddGuardianEmail;
  var _cmFlushPendingGuardians = CmGuardians._cmFlushPendingGuardians;
  var _cmJoinWords = CmGuardians._cmJoinWords;
  var _cmPlural = CmGuardians._cmPlural;
  var _cmRenderImportReview = CmGuardians._cmRenderImportReview;
  var _isServerPerson = CmGuardians._isServerPerson;
  var cmCancelImport = CmGuardians.cmCancelImport;
  var cmConfirmImport = CmGuardians.cmConfirmImport;
  var cmHandleCSV = CmGuardians.cmHandleCSV;
  var cmImportChooseNames = CmGuardians.cmImportChooseNames;
  var cmImportDateOrder = CmGuardians.cmImportDateOrder;
  var cmImportFix = CmGuardians.cmImportFix;
  var cmImportMap = CmGuardians.cmImportMap;
  var cmImportPick = CmGuardians.cmImportPick;
  var cmImportShowAll = CmGuardians.cmImportShowAll;
  var cmImportShowColumns = CmGuardians.cmImportShowColumns;
  var cmImportToggle = CmGuardians.cmImportToggle;
  var cmImportToggleAll = CmGuardians.cmImportToggleAll;
  var cmShowImportPreview = CmGuardians.cmShowImportPreview;
  var cmStartImport = CmGuardians.cmStartImport;
  /* In cm-roster-import.js (moved 2026-11-26). */
  var ROSTER_FIELD_MENU = CmRosterImport.ROSTER_FIELD_MENU;
  var ROSTER_IMPORT_FIELDS = CmRosterImport.ROSTER_IMPORT_FIELDS;
  var ROSTER_SKIPPED_HEADERS = CmRosterImport.ROSTER_SKIPPED_HEADERS;
  var _ROSTER_NUM_DATE = CmRosterImport._ROSTER_NUM_DATE;
  var _cmFocus = CmRosterImport._cmFocus;
  var _cmImportDoneHtml = CmRosterImport._cmImportDoneHtml;
  var _cmImportErrorHtml = CmRosterImport._cmImportErrorHtml;
  var _cmImportNewIds = CmRosterImport._cmImportNewIds;
  var _cmRosterOnlyIds = CmRosterImport._cmRosterOnlyIds;
  var _rosterCodes = CmRosterImport._rosterCodes;
  var _rosterColumn = CmRosterImport._rosterColumn;
  var _rosterDate = CmRosterImport._rosterDate;
  var _rosterHeaderKey = CmRosterImport._rosterHeaderKey;
  var cmChooseRosterFile = CmRosterImport.cmChooseRosterFile;
  var cmCloseImportDone = CmRosterImport.cmCloseImportDone;
  var cmCloseImportFormat = CmRosterImport.cmCloseImportFormat;
  var cmImportEmptyHtml = CmRosterImport.cmImportEmptyHtml;
  var cmImportFormatHtml = CmRosterImport.cmImportFormatHtml;
  var cmImportRoster = CmRosterImport.cmImportRoster;
  var cmImportShowBlanks = CmRosterImport.cmImportShowBlanks;
  var cmUndoImport = CmRosterImport.cmUndoImport;
  var parseRosterCsv = CmRosterImport.parseRosterCsv;
  var rosterDateOrder = CmRosterImport.rosterDateOrder;
  var rosterImportReady = CmRosterImport.rosterImportReady;
  var rosterImportTable = CmRosterImport.rosterImportTable;
  var rosterRowsFromTable = CmRosterImport.rosterRowsFromTable;
  /* In cm-students.js (moved 2026-11-26). */
  var _cmCloseRosterPicker = CmStudents._cmCloseRosterPicker;
  var _cmFloatOverScroll = CmStudents._cmFloatOverScroll;
  var _cmGuardianEmails = CmStudents._cmGuardianEmails;
  var _cmGuardiansFor = CmStudents._cmGuardiansFor;
  var _cmLoadGuardians = CmStudents._cmLoadGuardians;
  var _cmRosterHtml = CmStudents._cmRosterHtml;
  var _cmRosterKeydown = CmStudents._cmRosterKeydown;
  var _cmRosterSummary = CmStudents._cmRosterSummary;
  var _cmSetGuardianEmail = CmStudents._cmSetGuardianEmail;
  var cmCloseAddStudent = CmStudents.cmCloseAddStudent;
  var cmOpenStudentPage = CmStudents.cmOpenStudentPage;
  var cmRemoveStudent = CmStudents.cmRemoveStudent;
  var cmRosterDesigAdd = CmStudents.cmRosterDesigAdd;
  var cmRosterDesigOpen = CmStudents.cmRosterDesigOpen;
  var cmRosterDesigRemove = CmStudents.cmRosterDesigRemove;
  var cmRosterEll = CmStudents.cmRosterEll;
  var cmRosterField = CmStudents.cmRosterField;
  var cmRosterSearch = CmStudents.cmRosterSearch;
  var cmRosterSort = CmStudents.cmRosterSort;
  var cmSaveStudent = CmStudents.cmSaveStudent;
  var cmShowAddStudent = CmStudents.cmShowAddStudent;
  CmStudents.configure({
    state: state,
    _cmAddGuardianEmail: _cmAddGuardianEmail,
    _cmCloseStdMenus: _cmCloseStdMenus,
    _cmFlushPendingGuardians: _cmFlushPendingGuardians,
    _cmImportNewIds: _cmImportNewIds,
    _cmNoteOpened: _cmNoteOpened,
    _cmRosterOnlyIds: _cmRosterOnlyIds,
    _isServerPerson: _isServerPerson,
    renderClassManager: renderClassManager,
    withdrawStudentUI: withdrawStudentUI,
  });
  CmRosterImport.configure({
    state: state,
    _cmJoinWords: _cmJoinWords,
    _cmPlural: _cmPlural,
    _cmRenderAndFocus: _cmRenderAndFocus,
    _cmTabShown: _cmTabShown,
    renderClassManager: renderClassManager,
  });
  CmGuardians.configure({
    state: state,
    _cmAttr: _cmAttr,
    _cmRenderAndFocus: _cmRenderAndFocus,
    renderClassManager: renderClassManager,
    ROSTER_FIELD_MENU: ROSTER_FIELD_MENU,
    ROSTER_SKIPPED_HEADERS: ROSTER_SKIPPED_HEADERS,
    _ROSTER_NUM_DATE: _ROSTER_NUM_DATE,
    _cmFocus: _cmFocus,
    _cmGuardiansFor: _cmGuardiansFor,
    _rosterCodes: _rosterCodes,
    _rosterColumn: _rosterColumn,
    _rosterDate: _rosterDate,
    _rosterHeaderKey: _rosterHeaderKey,
    rosterDateOrder: rosterDateOrder,
    rosterImportReady: rosterImportReady,
    rosterImportTable: rosterImportTable,
    rosterRowsFromTable: rosterRowsFromTable,
  });
  CmOtherClasses.configure({
    state: state,
    _cmCatPrepare: _cmCatPrepare,
    _cmCatState: _cmCatState,
    _cmRenderCompReview: _cmRenderCompReview,
    _cmRenderCompToolbar: _cmRenderCompToolbar,
    _cmRenderFoldersCountAsOne: _cmRenderFoldersCountAsOne,
    _cmRenderGradingTab: _cmRenderGradingTab,
    _cmRenderStdCard: _cmRenderStdCard,
    _cmRestoreKeptFocus: _cmRestoreKeptFocus,
    cmStartCreate: cmStartCreate,
    renderCmCreateForm: renderCmCreateForm,
    renderCmRelinkPanel: renderCmRelinkPanel,
    renderWithdrawnList: renderWithdrawnList,
    _cmFloatOverScroll: _cmFloatOverScroll,
    _cmImportDoneHtml: _cmImportDoneHtml,
    _cmImportErrorHtml: _cmImportErrorHtml,
    _cmLoadGuardians: _cmLoadGuardians,
    _cmRenderImportReview: _cmRenderImportReview,
    _cmRosterHtml: _cmRosterHtml,
    _cmRosterSummary: _cmRosterSummary,
    cmImportEmptyHtml: cmImportEmptyHtml,
    cmImportFormatHtml: cmImportFormatHtml,
  });
  CmGrading.configure({
    state: state,
    _cmDefaultGradingSystem: _cmDefaultGradingSystem,
    _cmRenderCategoriesField: _cmRenderCategoriesField,
    _cmRenderLevelOrderField: _cmRenderLevelOrderField,
    _cmStdCode: _cmStdCode,
    cmSetFolderCountsAsOne: cmSetFolderCountsAsOne,
    cmSetFoldersCountAsOne: cmSetFoldersCountAsOne,
    cmSetRoundPercent: cmSetRoundPercent,
    renderClassManager: renderClassManager,
  });
  CmWizard.configure({
    state: state,
    _awaitCanonicalCourse: _awaitCanonicalCourse,
    _cmCalcMethodDescription: _cmCalcMethodDescription,
    _cmDefaultCalcMethod: _cmDefaultCalcMethod,
    _cmDefaultGradingScale: _cmDefaultGradingScale,
    _cmDefaultGradingSystem: _cmDefaultGradingSystem,
    _cmDefaultLevelOrder: _cmDefaultLevelOrder,
    _cmGradingSystemDescription: _cmGradingSystemDescription,
    _resolvesTrueWithin: _resolvesTrueWithin,
    _cwCourseRow: _cwCourseRow,
    _cwSeg: _cwSeg,
    _cwSetRow: _cwSetRow,
    blockPickerHtml: blockPickerHtml,
    readBlockPicker: readBlockPicker,
    renderClassManager: renderClassManager,
  });
  CmEditActions.configure({
    state: state,
    _addDocListener: _addDocListener,
    _cmRenderWithScroll: _cmRenderWithScroll,
    _currentId: _currentId,
    CM_METHOD_TEXT: CM_METHOD_TEXT,
    _cmEndedTerm: _cmEndedTerm,
    _cmMethodRule: _cmMethodRule,
    _cmRefreshSidebar: _cmRefreshSidebar,
    renderClassManager: renderClassManager,
  });
  CmClassActions.configure({
    state: state,
    _cmPhotosBeforeDelete: _cmPhotosBeforeDelete,
    blockChipSelect: blockChipSelect,
    blockOtherInput: blockOtherInput,
    blockPickerHtml: blockPickerHtml,
    readBlockPicker: readBlockPicker,
    renderClassManager: renderClassManager,
  });
  CmCurriculum.configure({
    state: state,
    _cmOpenCompReview: _cmOpenCompReview,
    _cmRemoveMessage: _cmRemoveMessage,
    _cmStdCode: _cmStdCode,
    _currentId: _currentId,
    renderClassManager: renderClassManager,
  });
  CmDispatch.configure({
    state: state,
    _cmCloseStdMenus: _cmCloseStdMenus,
    cmAddTag: cmAddTag,
    cmCancelCreate: cmCancelCreate,
    cmCompReviewApply: cmCompReviewApply,
    cmCompReviewCancel: cmCompReviewCancel,
    cmCompReviewPick: cmCompReviewPick,
    cmCompReviewShowSame: cmCompReviewShowSame,
    cmCompReviewToggle: cmCompReviewToggle,
    cmCreateToggle: cmCreateToggle,
    cmDeleteStd: cmDeleteStd,
    cmDeleteTag: cmDeleteTag,
    cmDeleteWithdrawn: cmDeleteWithdrawn,
    cmIcanAdd: cmIcanAdd,
    cmIcanDelete: cmIcanDelete,
    cmIcanEdit: cmIcanEdit,
    cmLevelsCancel: cmLevelsCancel,
    cmLevelsDraft: cmLevelsDraft,
    cmLevelsEdit: cmLevelsEdit,
    cmLevelsSave: cmLevelsSave,
    cmReenrolStudent: cmReenrolStudent,
    cmRelinkCancel: cmRelinkCancel,
    cmRelinkNext: cmRelinkNext,
    cmSelectClass: cmSelectClass,
    cmStartCreate: cmStartCreate,
    cmStartRelink: cmStartRelink,
    cmStdCodeLive: cmStdCodeLive,
    cmStdEditWording: cmStdEditWording,
    cmStdFinishWording: cmStdFinishWording,
    cmStdLabelLive: cmStdLabelLive,
    cmStdRestoreWording: cmStdRestoreWording,
    cmStdToggleMenu: cmStdToggleMenu,
    cmToggleStdCard: cmToggleStdCard,
    cmToggleStdFolder: cmToggleStdFolder,
    cmUpdateStdCode: cmUpdateStdCode,
    cmUpdateStdLabel: cmUpdateStdLabel,
    cmUpdateTagLabel: cmUpdateTagLabel,
    cmUpdateTagText: cmUpdateTagText,
    cwGradeInput: cwGradeInput,
    _cmCloseRosterPicker: _cmCloseRosterPicker,
    _cmRosterKeydown: _cmRosterKeydown,
    _cmShownTabs: _cmShownTabs,
    _cmTabShown: _cmTabShown,
    _cwRailSync: _cwRailSync,
    blockChipSelect: blockChipSelect,
    blockOtherInput: blockOtherInput,
    closeClassManager: closeClassManager,
    cmAddCompGroup: cmAddCompGroup,
    cmAddStd: cmAddStd,
    cmAddSubject: cmAddSubject,
    cmBcPointsScale: cmBcPointsScale,
    cmCancelImport: cmCancelImport,
    cmCatAdd: cmCatAdd,
    cmCatAssignUncategorized: cmCatAssignUncategorized,
    cmCatDelete: cmCatDelete,
    cmCatMode: cmCatMode,
    cmCatMoveCancel: cmCatMoveCancel,
    cmCatMoveDelete: cmCatMoveDelete,
    cmCatNameLive: cmCatNameLive,
    cmCatNoticeDone: cmCatNoticeDone,
    cmCatSave: cmCatSave,
    cmCatWeightLive: cmCatWeightLive,
    cmCheckStudent: cmCheckStudent,
    cmChooseRosterFile: cmChooseRosterFile,
    cmCloseAddStudent: cmCloseAddStudent,
    cmCloseImportDone: cmCloseImportDone,
    cmCloseImportFormat: cmCloseImportFormat,
    cmCompCSV: cmCompCSV,
    cmCompExport: cmCompExport,
    cmCompImport: cmCompImport,
    cmCompMove: cmCompMove,
    cmCompRemoveSelected: cmCompRemoveSelected,
    cmCompSelectAll: cmCompSelectAll,
    cmCompSelectDone: cmCompSelectDone,
    cmCompSelectStart: cmCompSelectStart,
    cmCompToggle: cmCompToggle,
    cmConfirmImport: cmConfirmImport,
    cmDeleteCompGroup: cmDeleteCompGroup,
    cmDeleteCourse: cmDeleteCourse,
    cmDeleteSubject: cmDeleteSubject,
    cmDownloadBackup: cmDownloadBackup,
    cmDuplicateCourse: cmDuplicateCourse,
    cmFolderCountChoice: cmFolderCountChoice,
    cmHandleCSV: cmHandleCSV,
    cmImportChooseNames: cmImportChooseNames,
    cmImportDateOrder: cmImportDateOrder,
    cmImportFix: cmImportFix,
    cmImportMap: cmImportMap,
    cmImportPick: cmImportPick,
    cmImportRoster: cmImportRoster,
    cmImportShowAll: cmImportShowAll,
    cmImportShowBlanks: cmImportShowBlanks,
    cmImportShowColumns: cmImportShowColumns,
    cmImportToggle: cmImportToggle,
    cmImportToggleAll: cmImportToggleAll,
    cmMatchPointsScale: cmMatchPointsScale,
    cmOpenDemoMode: cmOpenDemoMode,
    cmOpenGradebook: cmOpenGradebook,
    cmOpenGroupColorPop: cmOpenGroupColorPop,
    cmOpenSetupCopy: cmOpenSetupCopy,
    cmOpenStudentPage: cmOpenStudentPage,
    cmPickColor: cmPickColor,
    cmPtsLive: cmPtsLive,
    cmRemoveStudent: cmRemoveStudent,
    cmResetPointsScale: cmResetPointsScale,
    cmRestoreBackup: cmRestoreBackup,
    cmRosterDesigAdd: cmRosterDesigAdd,
    cmRosterDesigOpen: cmRosterDesigOpen,
    cmRosterDesigRemove: cmRosterDesigRemove,
    cmRosterEll: cmRosterEll,
    cmRosterField: cmRosterField,
    cmRosterSearch: cmRosterSearch,
    cmRosterSort: cmRosterSort,
    cmRoundPercentSelect: cmRoundPercentSelect,
    cmSaveDecay: cmSaveDecay,
    cmSavePointsScale: cmSavePointsScale,
    cmSaveStudent: cmSaveStudent,
    cmSetCalcMethod: cmSetCalcMethod,
    cmSetCoursesCountEqually: cmSetCoursesCountEqually,
    cmSetFolderCountsAsOne: cmSetFolderCountsAsOne,
    cmSetFoldersCountAsOne: cmSetFoldersCountAsOne,
    cmSetGradingSystem: cmSetGradingSystem,
    cmSetLevelOrder: cmSetLevelOrder,
    cmSetRecentLimit: cmSetRecentLimit,
    cmSetRoundPercent: cmSetRoundPercent,
    cmSetTab: cmSetTab,
    cmShowAddStudent: cmShowAddStudent,
    cmToggleArchive: cmToggleArchive,
    cmToggleColorPalette: cmToggleColorPalette,
    cmUndoImport: cmUndoImport,
    cmUpdateCompGroupName: cmUpdateCompGroupName,
    cmUpdateDecay: cmUpdateDecay,
    cmUpdateField: cmUpdateField,
    cmUpdateStdColor: cmUpdateStdColor,
    cmUpdateStdGroup: cmUpdateStdGroup,
    cmUpdateStdName: cmUpdateStdName,
    cmUpdateStdSubject: cmUpdateStdSubject,
    cmUpdateSubjectColor: cmUpdateSubjectColor,
    cmUpdateSubjectName: cmUpdateSubjectName,
    cwCompToggle: cwCompToggle,
    cwFindInput: cwFindInput,
    cwFinishCreate: cwFinishCreate,
    cwFolderSet: cwFolderSet,
    cwGoBack: cwGoBack,
    cwGoToStep2: cwGoToStep2,
    cwNameInput: cwNameInput,
    cwOpenRow: cwOpenRow,
    cwSelectGrade: cwSelectGrade,
    cwSkipToCustom: cwSkipToCustom,
    cwToggleCourse: cwToggleCourse,
    cwTogglePreset: cwTogglePreset,
    openClassManager: openClassManager,
    readBlockPicker: readBlockPicker,
    renderClassManager: renderClassManager,
  });
  CmCompetencyEdit.configure({
    state: state,
    _cmRemoveMessage: _cmRemoveMessage,
    _currentId: _currentId,
    _cmFloatOverScroll: _cmFloatOverScroll,
    renderClassManager: renderClassManager,
  });
  CmRelink.configure({
    state: state,
    _cmLoose: _cmLoose,
    _cmNorm: _cmNorm,
    _cmOpenCompReview: _cmOpenCompReview,
    _cmRenderCompReview: _cmRenderCompReview,
    _cmStdCode: _cmStdCode,
    _cwCourseCounts: _cwCourseCounts,
    renderClassManager: renderClassManager,
  });
  CmCompetencyImport.configure({
    state: state,
    _cmStdCode: _cmStdCode,
    _currentId: _currentId,
    CM_FOLDER_COUNT_SENT: CM_FOLDER_COUNT_SENT,
    _cmAttr: _cmAttr,
    _cmCompTitle: _cmCompTitle,
    _cmCrosswalkPairs: _cmCrosswalkPairs,
    _cmGradeChangeMessage: _cmGradeChangeMessage,
    _cmJoinNames: _cmJoinNames,
    _cmRenderAndFocus: _cmRenderAndFocus,
    renderClassManager: renderClassManager,
  });
  CmCompetencyCards.configure({
    state: state,
    _addDocListener: _addDocListener,
    _currentId: _currentId,
    _cmCloseStdMenus: _cmCloseStdMenus,
    _cmLevelsHtml: _cmLevelsHtml,
    _cmRenderStdSelectRow: _cmRenderStdSelectRow,
    _cmRenderWithScroll: _cmRenderWithScroll,
    cmHandleCSV: cmHandleCSV,
    cmIcanMove: cmIcanMove,
    renderClassManager: renderClassManager,
  });
  CmWithdrawn.configure({ state: state, renderClassManager: renderClassManager });

  /* ── Listener tracking for cleanup ──────────────────────── */
  state._listeners = [];
  function _addDocListener(type, handler, options) {
    document.addEventListener(type, handler, options);
    state._listeners.push({ type: type, handler: handler, options: options });
  }
  function _removeAllListeners() {
    closeColorPop();
    state._listeners.forEach(function (l) {
      document.removeEventListener(l.type, l.handler, l.options);
    });
    state._listeners = [];
  }

  /* ── Parent state injection ──────────────────────────────── */
  state._activeCourse = null;
  state._onRender = null;
  state._onCourseChange = null;
  // Set when the manager changes the active course itself (finishing the create
  // wizard, or archiving the class that was active). The parent page holds its
  // own copy of the active course for rendering and only learns about a change
  // through _onCourseChange, so the switch is deferred until the manager closes
  // — announcing it mid-wizard would tear down the panel the teacher is using.
  state._activeCourseChanged = false;

  function configure(opts) {
    // The parent is telling us which course it is on, so any pending switch of
    // ours is now reflected there and must not be replayed on close.
    state._activeCourse = opts.activeCourse;
    state._activeCourseChanged = false;
    state._onRender = opts.onRender;
    state._onCourseChange = opts.onCourseChange;
  }
  var CM_COLORS = [
    '#dc2626',
    '#ea580c',
    '#d97706',
    '#ca8a04',
    '#16a34a',
    '#059669',
    '#0891b2',
    '#2563eb',
    '#7c3aed',
    '#c026d3',
    '#db2777',
    '#78716c',
    '#475569',
    '#1e3a5f',
    '#334155',
  ];

  // Single source of truth for calculation method options. Rendered by both
  // the create wizard (step 2) and the post-creation editor — keep order
  // identical across both surfaces. Value strings are persisted in
  // course.calcMethod and courseConfig.calcMethod; do not rename.
  var CALC_METHODS = [
    { value: 'mostRecent', label: 'Most Recent' },
    { value: 'highest', label: 'Highest' },
    { value: 'average', label: 'Mean' },
    { value: 'median', label: 'Median' },
    { value: 'mode', label: 'Mode' },
    { value: 'decayingAvg', label: 'Decaying Avg' },
  ];
  var GRADING_SYSTEMS = [
    { value: 'proficiency', label: 'Proficiency' },
    { value: 'letter', label: 'Letter' },
    { value: 'both', label: 'Both' },
  ];

  state.classManagerOpen = false;
  state.cmSelectedCourse = null;
  state.cmMode = 'edit';
  // details | students | questionnaires | grading | terms | competencies,
  // and student-page where that tab is shown (CM_TABS).
  state.cmTab = 'details';

  // Curriculum Wizard state
  state.cwStep = 1;
  state.cwSelectedGrade = null;
  state.cwSelectedSubject = null;
  state.cwSelectedTags = [];
  state.cwCurriculumLoaded = false;
  state.cwLoadError = false;

  // Class Manager student editing
  state.cmEditingStudentId = null;

  // Students tab roster: sort, search, and each class's guardians by enrollment
  state.cmRosterSortMode = 'lastName';
  state.cmRosterQuery = '';
  var _cmGuardians = {};
  CmGuardians.configure({ _cmGuardians: _cmGuardians });
  CmRosterImport.configure({ _cmGuardians: _cmGuardians });
  CmStudents.configure({ _cmGuardians: _cmGuardians });
  state._cmGuardiansLoaded = {};
  state._cmGuardiansReady = {};
  state._cmGuardiansLoading = {};

  // Import preview
  state.cmPendingImport = null;
  state.cmImportFormatOpen = false; // Import Roster's strip, for a class with students
  state.cmImportError = null; // { kind: 'excel' | 'empty', fileName }
  state.cmImportDone = null; // the Done panel: { cid, added, blanks, counts, undone }
  state.cmRosterOnly = null; // Show Them: the roster shows only these students

  // Relink
  state.cmRelinkCid = null;
  state.cmRelinkStep = 0;

  // Standard folder collapse state
  state._cmCollapsedStdFolders = {};
  state._cmOpenStdCards = {};

  // Card state that lives outside the learning map: which cards are editing
  // their wording, and the I Can statement being dragged.
  var _cmWordingEdit = {};
  // Cards whose Levels are open for Write Your Own, by section id.
  var _cmLevelsEdit = {};
  CmCompetencyEdit.configure({ _cmLevelsEdit: _cmLevelsEdit, _cmWordingEdit: _cmWordingEdit });
  state._cmLevelsBankAsked = false;
  state._cmIcanDrag = null;

  state._cmBankPlaces = null;
  state._cmBankPlacesOf = null;
  state._cmBankLoading = false;

  /* ── Where These Appear: teacher/cm-std-help.js ── */
  CmStdHelp.configure({
    selectedCourse: function () {
      return state.cmSelectedCourse;
    },
    stdCode: _cmStdCode,
    currentId: _currentId,
  });
  var cmShowStdHelp = CmStdHelp.cmShowStdHelp;
  /* ── Points and Proficiency presets, Course Percentage bar: teacher/cm-grading-bars.js ── */
  CmGradingBars.configure({
    selectedCourse: function () {
      return state.cmSelectedCourse;
    },
    catRows: function (cid) {
      return _cmCatState(cid).rows;
    },
    setWeight: function (idx, value) {
      cmCatWeightLive(idx, value);
    },
  });

  CmPtsEdit.configure({
    state: state,
    render: function () {
      renderClassManager();
    },
    refreshCheck: CmGrading.refreshCheck,
    endedTerm: _cmEndedTerm,
    openCopy: cmOpenSetupCopy,
  });

  // Drag-and-drop for standards between group folders
  state._cmDragStdId = null;
  state._cmMergeTargetId = null;
  state._cmMergeHoverTimer = null;
  state._cmMergeAnimating = false;
  var CM_GROUP_COLORS = [
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
  CmCurriculum.configure({ CM_COLORS: CM_COLORS, CM_GROUP_COLORS: CM_GROUP_COLORS });

  var _UUID_RE_CM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  CmCompetencyCards.configure({
    CM_GROUP_COLORS: CM_GROUP_COLORS,
    _UUID_RE_CM: _UUID_RE_CM,
    _cmWordingEdit: _cmWordingEdit,
  });
  // True unless the promise settles false within ms. A slow or offline save
  // is still queued in the outbox, so it isn't reported as a failure.
  function _resolvesTrueWithin(promise, ms) {
    return Promise.race([
      Promise.resolve(promise).then(function (ok) {
        return ok !== false;
      }),
      new Promise(function (resolve) {
        setTimeout(function () {
          resolve(true);
        }, ms);
      }),
    ]);
  }

  // Inputs rendered before a new row's server id came back still carry its
  // local id; look rows up by their current id.
  function _currentId(kind, id) {
    return state.cmSelectedCourse && id ? resolveLearningMapId(state.cmSelectedCourse, kind, id) : id;
  }

  function _isCanonicalId(id) {
    return typeof id === 'string' && _UUID_RE_CM.test(id);
  }

  // Wait for the create_course RPC fired by createCourse (shared/data.js)
  // to settle. createCourse returns a course object with a local id like
  // "c{ts}{rand}" before the canonical UUID is known; the rekey lands when
  // the RPC callback runs and replaces COURSES[localId] with
  // COURSES[canonicalId]. The canonical row keeps a __pendingLocalId tag so
  // we can find it after rekey.
  async function _awaitCanonicalCourse(localId, timeoutMs) {
    if (_isCanonicalId(localId)) return localId;
    var deadline = Date.now() + (timeoutMs || 10000);
    while (Date.now() < deadline) {
      if (!COURSES[localId]) {
        var keys = Object.keys(COURSES);
        for (var i = 0; i < keys.length; i++) {
          if (COURSES[keys[i]] && COURSES[keys[i]].__pendingLocalId === localId) {
            return keys[i];
          }
        }
      }
      // Nothing in flight and no canonical id in sight: either create_course
      // failed or we're offline / local-only, where the rekey never happens.
      // Bail rather than blocking the wizard for the full timeout — createCourse
      // clears the pending marker only after the rekey, so a successful create
      // is always caught by the lookup above first.
      if (typeof hasPendingLocalCid === 'function' && !hasPendingLocalCid(localId)) return null;
      await new Promise(function (r) {
        setTimeout(r, 75);
      });
    }
    return null;
  }

  // Choose Competencies: bank ids the teacher unticked, and the preset
  // picked in Choose Courses (Humanities 8).
  state.cwSkipped = {};
  state.cwPreset = null;
  // The Choose Courses find box, and the Already Set for You row open.
  state.cwFindText = '';
  state.cwOpen = '';
  // Presets that tick more than one course, in Choose Courses.
  var CW_PRESETS = [{ id: 'HUM8', name: 'Humanities 8', grade: 8, tags: ['ELA8', 'SS8'] }];

  // The Class Name as typed; null while it is still the one the courses give.
  state.cwStep2Name = null;
  state.cwStep2Grade = '';
  state.cwStep2Block = '';
  state.cwStep2Span = 'full';
  // '' = not chosen yet; the wizard fills in the grade-level default.
  state.cwStep2Grading = '';
  state.cwStep2Calc = '';
  state.cwStep2Decay = '65';
  ROSTER_IMPORT_FIELDS.forEach(function (f) {
    _CM_FIELD_LABEL[f[0]] = f[1];
  });

  /* ── CM Actions ─────────────────────────────────────────── */
  function cmSelectClass(cid) {
    if (cid !== state.cmSelectedCourse) {
      // A review or a selection belongs to its class.
      state.cmPendingImport = null;
      state.cmImportFormatOpen = false;
      state.cmImportError = null;
      state.cmImportDone = null;
      state.cmRosterOnly = null;
      if (state.cmCompReview && state.cmCompReview.kind === 'file') state.cmCompReview = null;
      state.cmCompSelect = false;
      state.cmCompSelected = {};
    }
    state.cmSelectedCourse = cid;
    state.cmMode = 'edit';
    renderClassManager();
    _cmShowWhenLoaded(cid);
    _cmNoteOpened(cid);
  }

  function cmStartCreate() {
    state.cmMode = 'create';
    state.cmSelectedCourse = null;
    state.cwStep = 1;
    state.cwSelectedGrade = null;
    state.cwSelectedSubject = null;
    state.cwSelectedTags = [];
    state.cwSkipped = {};
    state.cwPreset = null;
    state.cwLoadError = false;
    state.cwStep2Name = null;
    state.cwStep2Grade = '';
    state.cwStep2Block = '';
    state.cwStep2Span = 'full';
    CmTermsStart.reset();
    state.cwStep2Grading = '';
    state.cwStep2Calc = '';
    state.cwStep2Decay = '65';
    state.cwFindText = '';
    state.cwOpen = '';
    loadCurriculumIndex().then(function (idx) {
      state.cwCurriculumLoaded = !!idx;
      state.cwLoadError = !idx;
      if (state.cmMode === 'create' && state.cwStep === 1) renderClassManager();
    });
    renderClassManager();
  }

  function cmCancelCreate() {
    state.cmMode = 'edit';
    state.cmSelectedCourse = state._activeCourse;
    renderClassManager();
  }

  function cmCreateToggle(btn, containerId) {
    segSelect(btn);
    if (containerId === 'cm-cg-span') {
      state.cwStep2Span = btn.dataset.val || 'full';
      CmWizard.cwSpanChanged();
    }
    if (containerId === 'cm-cg-calc') {
      state.cwStep2Calc = btn.dataset.val;
      var desc = document.getElementById('cm-cg-calc-desc');
      if (desc) desc.innerHTML = _cmCalcMethodDescription(btn.dataset.val);
    }
    if (containerId === 'cm-cg-grading') {
      state.cwStep2Grading = btn.dataset.val;
      var gdesc = document.getElementById('cm-cg-grading-desc');
      if (gdesc) gdesc.innerHTML = _cmGradingSystemDescription(btn.dataset.val);
    }
  }

  // Typing a grade level re-applies the grade defaults to any picker the
  // teacher hasn't chosen yet.
  function cwGradeInput(value) {
    state.cwStep2Grade = value || '';
    _cwRailSync();
    if (!state.cwStep2Grading) {
      var gs = _cmDefaultGradingSystem({ gradeLevel: value });
      var gbtn = document.querySelector('#cm-cg-grading .cm-seg-btn[data-val="' + gs + '"]');
      if (gbtn) {
        cmCreateToggle(gbtn, 'cm-cg-grading');
        state.cwStep2Grading = '';
      }
    }
    if (!state.cwStep2Calc) {
      var cbtn = document.querySelector('#cm-cg-calc .cm-seg-btn[data-val="' + _cmDefaultCalcMethod() + '"]');
      if (cbtn) {
        cmCreateToggle(cbtn, 'cm-cg-calc');
        state.cwStep2Calc = '';
        var dp = document.getElementById('cm-cg-decay');
        if (dp) dp.style.display = 'none';
      }
    }
  }

  // T-UI-12 · Category management inline row.
  // Per-course state: { rows: [{id?, name, weight, display_order}], loaded, loading }.
  // Rows without `id` are new (not yet persisted). `loaded` flips true after
  // list_categories resolves at least once for the course.
  state._cmCategoryState = {};

  // Drag-reorder using delegated document listeners. Drop on another row → move.
  state._cmCatDragId = null;

  /* ── Reporting terms: teacher/cm-terms.js ── */
  CmTerms.configure({
    selectedCourse: function () {
      return state.cmSelectedCourse;
    },
    renderClassManager: renderClassManager,
  });
  var _cmTermState = CmTerms._cmTermState;
  CmEditActions.configure({ _cmTermState: _cmTermState });
  var _cmTermSchool = CmTerms._cmTermSchool;
  var _cmTermRows = CmTerms._cmTermRows;
  var _cmTermError = CmTerms._cmTermError;
  CmWizard.configure({ CALC_METHODS: CALC_METHODS, CW_PRESETS: CW_PRESETS, GRADING_SYSTEMS: GRADING_SYSTEMS });
  CmTermsStart.configure({ state: state, redraw: CmWizard.redraw, changed: CmWizard.cwSyncCreate });
  var _cmRenderReportingTermsField = CmTerms._cmRenderReportingTermsField;
  CmOtherClasses.configure({
    _cmRenderReportingTermsField: _cmRenderReportingTermsField,
    _cmTermSchool: _cmTermSchool,
  });
  var cmTermSchool = CmTerms.cmTermSchool;
  var cmTermLive = CmTerms.cmTermLive;
  CmDispatch.configure({ cmShowStdHelp: cmShowStdHelp, cmTermLive: cmTermLive, cmTermSchool: cmTermSchool });

  /* ── Competencies toolbar, select mode, CSV ─────────────────
     Select picks several competencies to move into a folder or remove
     (scores kept). Import / Export writes the list as a CSV and reads one
     back through the same review Re-link uses, so nothing is added twice. */
  state.cmCompSelect = false;
  state.cmCompSelected = {};
  state.cmCompReview = null;

  /* The crosswalk from the old bank (curriculum_crosswalk.json), loaded
     with the curriculum for Re-link. */
  state._cmCrosswalk = null;

  /* A switch, checkbox, radio or menu changed with the keyboard keeps the
     focus: most changes redraw Class Settings, which made the control a
     new element and dropped the focus to the page. Until the next click or
     change, a redraw that leaves the focus nowhere gives it back to the same
     control (by id, else by its data attributes), including the redraws
     around a "Change Grades?" question and its answer. */
  state._cmKeepFocusSel = null;

  /* ── Namespace ──────────────────────────────────────────── */
  return {
    configure: configure,
    get classManagerOpen() {
      return state.classManagerOpen;
    },
    set classManagerOpen(v) {
      state.classManagerOpen = v;
    },
    openClassManager: openClassManager,
    closeClassManager: closeClassManager,
    // The grading scale a new class starts with for its grade (tests).
    defaultGradingScale: _cmDefaultGradingScale,
    renderClassManager: renderClassManager,
    // The copy step behind the Duplicate Class dialog (block '' = none).
    duplicateCourse: _cmDuplicateCourse,
    handleAction: handleAction,
    // The reporting terms draft as the editor holds it (tests).
    // For tests: the import review a CSV file opens.
    cmShowImportPreview: cmShowImportPreview,
    cmStartImport: cmStartImport,
    parseRosterCsv: parseRosterCsv,
    rosterImportTable: rosterImportTable,
    rosterRowsFromTable: rosterRowsFromTable,
    rosterImportReady: rosterImportReady,
    rosterDateOrder: rosterDateOrder,
    rosterDate: _rosterDate,
    cmCompRowsFromCsv: cmCompRowsFromCsv,
    withdrawnRecordRows: _cmWithdrawnRecordRows,
    // The Edit Student dialog's Parent Email and Parent Email 2.
    guardianEmails: _cmGuardianEmails,
    saveGuardianEmail: _cmSetGuardianEmail,
    reportingTermsDraft: function (cid) {
      var st = _cmTermRows(cid || state.cmSelectedCourse);
      return { rows: st.rows.slice(), dirty: st.dirty, error: _cmTermError(cid || state.cmSelectedCourse) };
    },
    // The categories as Class Settings holds them, and a drag's move.
    categoriesDraft: function (cid) {
      var st = _cmCatState(cid || state.cmSelectedCourse);
      return {
        rows: st.rows.slice(),
        dirty: !!st.dirty,
        notice: _cmCatNoticeText(st),
        action: _cmCatNoticeAction(st),
        typed: st.notice && st.notice.kind === 'changed' && st.typed ? st.typed.map(_cmCatTypedLine) : null,
      };
    },
    reorderCategory: function (fromIdx, toIdx) {
      return state.cmSelectedCourse ? _cmCatReorder(state.cmSelectedCourse, fromIdx, toIdx) : Promise.resolve();
    },
    handleInput: handleInput,
    handleChange: handleChange,
    handleBlur: handleBlur,
    handleKeydown: handleKeydown,
    initDrag: function () {
      _initCmStdDrag();
      _initCmCatDrag();
      CmPtsPointer.init(_addDocListener);
      CmGradingBars.initDrag(_addDocListener);
    },
    destroy: _removeAllListeners,
    resetState: function () {
      state.classManagerOpen = false;
      state.cmMode = 'edit';
      state.cmTab = 'details';
      state.cmSelectedCourse = state._activeCourse;
      state._activeCourseChanged = false;
      CmPtsEdit.reset();
      state.cmEditingStudentId = null;
      state.cmRosterQuery = '';
      state._cmGuardiansLoaded = {};
      state._cmGuardiansReady = {};
      state._cmGuardiansLoading = {};
      state.cmPendingImport = null;
      state.cmImportFormatOpen = false;
      state.cmImportError = null;
      state.cmImportDone = null;
      state.cmRosterOnly = null;
      state.cmCompSelect = false;
      state.cmCompSelected = {};
      state.cmCompReview = null;
      state.cmRelinkCid = null;
      state.cmRelinkStep = 0;
      state.cwStep = 1;
      state.cwSelectedGrade = null;
      state.cwSelectedSubject = null;
      state.cwSelectedTags = [];
      state.cwStep2Name = null;
      state.cwStep2Grade = '';
      state.cwStep2Block = '';
      state.cwStep2Span = 'full';
      CmTermsStart.reset();
      state.cwStep2Grading = '';
      state.cwStep2Calc = '';
      state.cwStep2Decay = '65';
      state.cwFindText = '';
      state.cwOpen = '';
      state._cmCollapsedStdFolders = {};
      state._cmOpenStdCards = {};
      state._cmCategoryState = {};
    },
  };
})();
