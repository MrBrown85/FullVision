// @ts-check
/* cm-dispatch.js — Class Settings: the click, input, change, key and blur handlers. Moved from teacher/dash-class-manager.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. DashClassManager hands
   over what this file uses through configure(). It loads before dash-class-manager.js. */
/** @type {any} */ (window).CmDispatch = (function () {
  'use strict';

  /* Handed over by DashClassManager (configure). */
  var _cmCloseRosterPicker,
    _cmPtsKeydown,
    _cmRosterKeydown,
    _cmShownTabs,
    _cmTabShown,
    _cwRailSync,
    blockChipSelect,
    blockOtherInput,
    closeClassManager,
    cmAddCompGroup,
    cmAddStd,
    cmAddSubject,
    cmBcPointsScale,
    cmCancelImport,
    cmCatAdd,
    cmCatAssignUncategorized,
    cmCatDelete,
    cmCatMode,
    cmCatMoveCancel,
    cmCatMoveDelete,
    cmCatNameLive,
    cmCatNoticeDone,
    cmCatSave,
    cmCatWeightLive,
    cmCheckStudent,
    cmChooseRosterFile,
    cmCloseAddStudent,
    cmCloseImportDone,
    cmCloseImportFormat,
    cmCompCSV,
    cmCompExport,
    cmCompImport,
    cmCompMove,
    cmCompRemoveSelected,
    cmCompSelectAll,
    cmCompSelectDone,
    cmCompSelectStart,
    cmCompToggle,
    cmConfirmImport,
    cmDeleteCompGroup,
    cmDeleteCourse,
    cmDeleteSubject,
    cmDownloadBackup,
    cmDuplicateCourse,
    cmFolderCountChoice,
    cmHandleCSV,
    cmImportChooseNames,
    cmImportDateOrder,
    cmImportFix,
    cmImportMap,
    cmImportPick,
    cmImportRoster,
    cmImportShowAll,
    cmImportShowBlanks,
    cmImportShowColumns,
    cmImportToggle,
    cmImportToggleAll,
    cmMatchPointsScale,
    cmOpenDemoMode,
    cmOpenGradebook,
    cmOpenGroupColorPop,
    cmOpenSetupCopy,
    cmOpenStudentPage,
    cmPickColor,
    cmPtsLive,
    cmPtsPick,
    cmRemoveStudent,
    cmResetPointsScale,
    cmRestoreBackup,
    cmRosterDesigAdd,
    cmRosterDesigOpen,
    cmRosterDesigRemove,
    cmRosterEll,
    cmRosterField,
    cmRosterSearch,
    cmRosterSort,
    cmRoundPercentSelect,
    cmSaveDecay,
    cmSavePointsScale,
    cmSaveStudent,
    cmSetCalcMethod,
    cmSetCoursesCountEqually,
    cmSetFolderCountsAsOne,
    cmSetFoldersCountAsOne,
    cmSetGradingSystem,
    cmSetLevelOrder,
    cmSetRecentLimit,
    cmSetRoundPercent,
    cmSetTab,
    cmShowAddStudent,
    cmShowStdHelp,
    cmTermLive,
    cmTermSchool,
    cmToggleArchive,
    cmToggleColorPalette,
    cmUndoImport,
    cmUpdateCompGroupName,
    cmUpdateDecay,
    cmUpdateField,
    cmUpdateStdColor,
    cmUpdateStdGroup,
    cmUpdateStdName,
    cmUpdateStdSubject,
    cmUpdateSubjectColor,
    cmUpdateSubjectName,
    cwCompToggle,
    cwFindInput,
    cwFinishCreate,
    cwFolderSet,
    cwGoBack,
    cwGoToStep2,
    cwNameInput,
    cwOpenRow,
    cwSelectGrade,
    cwSetRollup,
    cwSkipToCustom,
    cwToggleCourse,
    cwTogglePreset,
    openClassManager,
    readBlockPicker,
    renderClassManager,
    state,
    _cmCloseStdMenus,
    cmAddTag,
    cmCancelCreate,
    cmCompReviewApply,
    cmCompReviewCancel,
    cmCompReviewPick,
    cmCompReviewShowSame,
    cmCompReviewToggle,
    cmCreateToggle,
    cmDeleteStd,
    cmDeleteTag,
    cmDeleteWithdrawn,
    cmIcanAdd,
    cmIcanDelete,
    cmIcanEdit,
    cmLevelsCancel,
    cmLevelsDraft,
    cmLevelsEdit,
    cmLevelsSave,
    cmReenrolStudent,
    cmRelinkCancel,
    cmRelinkNext,
    cmSelectClass,
    cmStartCreate,
    cmStartRelink,
    cmStdCodeLive,
    cmStdEditWording,
    cmStdFinishWording,
    cmStdLabelLive,
    cmStdRestoreWording,
    cmStdToggleMenu,
    cmToggleStdCard,
    cmToggleStdFolder,
    cmUpdateStdCode,
    cmUpdateStdLabel,
    cmUpdateTagLabel,
    cmUpdateTagText,
    cwGradeInput;
  function configure(h) {
    if ('_cmCloseRosterPicker' in h) _cmCloseRosterPicker = h._cmCloseRosterPicker;
    if ('_cmPtsKeydown' in h) _cmPtsKeydown = h._cmPtsKeydown;
    if ('_cmRosterKeydown' in h) _cmRosterKeydown = h._cmRosterKeydown;
    if ('_cmShownTabs' in h) _cmShownTabs = h._cmShownTabs;
    if ('_cmTabShown' in h) _cmTabShown = h._cmTabShown;
    if ('_cwRailSync' in h) _cwRailSync = h._cwRailSync;
    if ('blockChipSelect' in h) blockChipSelect = h.blockChipSelect;
    if ('blockOtherInput' in h) blockOtherInput = h.blockOtherInput;
    if ('closeClassManager' in h) closeClassManager = h.closeClassManager;
    if ('cmAddCompGroup' in h) cmAddCompGroup = h.cmAddCompGroup;
    if ('cmAddStd' in h) cmAddStd = h.cmAddStd;
    if ('cmAddSubject' in h) cmAddSubject = h.cmAddSubject;
    if ('cmBcPointsScale' in h) cmBcPointsScale = h.cmBcPointsScale;
    if ('cmCancelImport' in h) cmCancelImport = h.cmCancelImport;
    if ('cmCatAdd' in h) cmCatAdd = h.cmCatAdd;
    if ('cmCatAssignUncategorized' in h) cmCatAssignUncategorized = h.cmCatAssignUncategorized;
    if ('cmCatDelete' in h) cmCatDelete = h.cmCatDelete;
    if ('cmCatMode' in h) cmCatMode = h.cmCatMode;
    if ('cmCatMoveCancel' in h) cmCatMoveCancel = h.cmCatMoveCancel;
    if ('cmCatMoveDelete' in h) cmCatMoveDelete = h.cmCatMoveDelete;
    if ('cmCatNameLive' in h) cmCatNameLive = h.cmCatNameLive;
    if ('cmCatNoticeDone' in h) cmCatNoticeDone = h.cmCatNoticeDone;
    if ('cmCatSave' in h) cmCatSave = h.cmCatSave;
    if ('cmCatWeightLive' in h) cmCatWeightLive = h.cmCatWeightLive;
    if ('cmCheckStudent' in h) cmCheckStudent = h.cmCheckStudent;
    if ('cmChooseRosterFile' in h) cmChooseRosterFile = h.cmChooseRosterFile;
    if ('cmCloseAddStudent' in h) cmCloseAddStudent = h.cmCloseAddStudent;
    if ('cmCloseImportDone' in h) cmCloseImportDone = h.cmCloseImportDone;
    if ('cmCloseImportFormat' in h) cmCloseImportFormat = h.cmCloseImportFormat;
    if ('cmCompCSV' in h) cmCompCSV = h.cmCompCSV;
    if ('cmCompExport' in h) cmCompExport = h.cmCompExport;
    if ('cmCompImport' in h) cmCompImport = h.cmCompImport;
    if ('cmCompMove' in h) cmCompMove = h.cmCompMove;
    if ('cmCompRemoveSelected' in h) cmCompRemoveSelected = h.cmCompRemoveSelected;
    if ('cmCompSelectAll' in h) cmCompSelectAll = h.cmCompSelectAll;
    if ('cmCompSelectDone' in h) cmCompSelectDone = h.cmCompSelectDone;
    if ('cmCompSelectStart' in h) cmCompSelectStart = h.cmCompSelectStart;
    if ('cmCompToggle' in h) cmCompToggle = h.cmCompToggle;
    if ('cmConfirmImport' in h) cmConfirmImport = h.cmConfirmImport;
    if ('cmDeleteCompGroup' in h) cmDeleteCompGroup = h.cmDeleteCompGroup;
    if ('cmDeleteCourse' in h) cmDeleteCourse = h.cmDeleteCourse;
    if ('cmDeleteSubject' in h) cmDeleteSubject = h.cmDeleteSubject;
    if ('cmDownloadBackup' in h) cmDownloadBackup = h.cmDownloadBackup;
    if ('cmDuplicateCourse' in h) cmDuplicateCourse = h.cmDuplicateCourse;
    if ('cmFolderCountChoice' in h) cmFolderCountChoice = h.cmFolderCountChoice;
    if ('cmHandleCSV' in h) cmHandleCSV = h.cmHandleCSV;
    if ('cmImportChooseNames' in h) cmImportChooseNames = h.cmImportChooseNames;
    if ('cmImportDateOrder' in h) cmImportDateOrder = h.cmImportDateOrder;
    if ('cmImportFix' in h) cmImportFix = h.cmImportFix;
    if ('cmImportMap' in h) cmImportMap = h.cmImportMap;
    if ('cmImportPick' in h) cmImportPick = h.cmImportPick;
    if ('cmImportRoster' in h) cmImportRoster = h.cmImportRoster;
    if ('cmImportShowAll' in h) cmImportShowAll = h.cmImportShowAll;
    if ('cmImportShowBlanks' in h) cmImportShowBlanks = h.cmImportShowBlanks;
    if ('cmImportShowColumns' in h) cmImportShowColumns = h.cmImportShowColumns;
    if ('cmImportToggle' in h) cmImportToggle = h.cmImportToggle;
    if ('cmImportToggleAll' in h) cmImportToggleAll = h.cmImportToggleAll;
    if ('cmMatchPointsScale' in h) cmMatchPointsScale = h.cmMatchPointsScale;
    if ('cmOpenDemoMode' in h) cmOpenDemoMode = h.cmOpenDemoMode;
    if ('cmOpenGradebook' in h) cmOpenGradebook = h.cmOpenGradebook;
    if ('cmOpenGroupColorPop' in h) cmOpenGroupColorPop = h.cmOpenGroupColorPop;
    if ('cmOpenSetupCopy' in h) cmOpenSetupCopy = h.cmOpenSetupCopy;
    if ('cmOpenStudentPage' in h) cmOpenStudentPage = h.cmOpenStudentPage;
    if ('cmPickColor' in h) cmPickColor = h.cmPickColor;
    if ('cmPtsLive' in h) cmPtsLive = h.cmPtsLive;
    if ('cmPtsPick' in h) cmPtsPick = h.cmPtsPick;
    if ('cmRemoveStudent' in h) cmRemoveStudent = h.cmRemoveStudent;
    if ('cmResetPointsScale' in h) cmResetPointsScale = h.cmResetPointsScale;
    if ('cmRestoreBackup' in h) cmRestoreBackup = h.cmRestoreBackup;
    if ('cmRosterDesigAdd' in h) cmRosterDesigAdd = h.cmRosterDesigAdd;
    if ('cmRosterDesigOpen' in h) cmRosterDesigOpen = h.cmRosterDesigOpen;
    if ('cmRosterDesigRemove' in h) cmRosterDesigRemove = h.cmRosterDesigRemove;
    if ('cmRosterEll' in h) cmRosterEll = h.cmRosterEll;
    if ('cmRosterField' in h) cmRosterField = h.cmRosterField;
    if ('cmRosterSearch' in h) cmRosterSearch = h.cmRosterSearch;
    if ('cmRosterSort' in h) cmRosterSort = h.cmRosterSort;
    if ('cmRoundPercentSelect' in h) cmRoundPercentSelect = h.cmRoundPercentSelect;
    if ('cmSaveDecay' in h) cmSaveDecay = h.cmSaveDecay;
    if ('cmSavePointsScale' in h) cmSavePointsScale = h.cmSavePointsScale;
    if ('cmSaveStudent' in h) cmSaveStudent = h.cmSaveStudent;
    if ('cmSetCalcMethod' in h) cmSetCalcMethod = h.cmSetCalcMethod;
    if ('cmSetCoursesCountEqually' in h) cmSetCoursesCountEqually = h.cmSetCoursesCountEqually;
    if ('cmSetFolderCountsAsOne' in h) cmSetFolderCountsAsOne = h.cmSetFolderCountsAsOne;
    if ('cmSetFoldersCountAsOne' in h) cmSetFoldersCountAsOne = h.cmSetFoldersCountAsOne;
    if ('cmSetGradingSystem' in h) cmSetGradingSystem = h.cmSetGradingSystem;
    if ('cmSetLevelOrder' in h) cmSetLevelOrder = h.cmSetLevelOrder;
    if ('cmSetRecentLimit' in h) cmSetRecentLimit = h.cmSetRecentLimit;
    if ('cmSetRoundPercent' in h) cmSetRoundPercent = h.cmSetRoundPercent;
    if ('cmSetTab' in h) cmSetTab = h.cmSetTab;
    if ('cmShowAddStudent' in h) cmShowAddStudent = h.cmShowAddStudent;
    if ('cmShowStdHelp' in h) cmShowStdHelp = h.cmShowStdHelp;
    if ('cmTermLive' in h) cmTermLive = h.cmTermLive;
    if ('cmTermSchool' in h) cmTermSchool = h.cmTermSchool;
    if ('cmToggleArchive' in h) cmToggleArchive = h.cmToggleArchive;
    if ('cmToggleColorPalette' in h) cmToggleColorPalette = h.cmToggleColorPalette;
    if ('cmUndoImport' in h) cmUndoImport = h.cmUndoImport;
    if ('cmUpdateCompGroupName' in h) cmUpdateCompGroupName = h.cmUpdateCompGroupName;
    if ('cmUpdateDecay' in h) cmUpdateDecay = h.cmUpdateDecay;
    if ('cmUpdateField' in h) cmUpdateField = h.cmUpdateField;
    if ('cmUpdateStdColor' in h) cmUpdateStdColor = h.cmUpdateStdColor;
    if ('cmUpdateStdGroup' in h) cmUpdateStdGroup = h.cmUpdateStdGroup;
    if ('cmUpdateStdName' in h) cmUpdateStdName = h.cmUpdateStdName;
    if ('cmUpdateStdSubject' in h) cmUpdateStdSubject = h.cmUpdateStdSubject;
    if ('cmUpdateSubjectColor' in h) cmUpdateSubjectColor = h.cmUpdateSubjectColor;
    if ('cmUpdateSubjectName' in h) cmUpdateSubjectName = h.cmUpdateSubjectName;
    if ('cwCompToggle' in h) cwCompToggle = h.cwCompToggle;
    if ('cwFindInput' in h) cwFindInput = h.cwFindInput;
    if ('cwFinishCreate' in h) cwFinishCreate = h.cwFinishCreate;
    if ('cwFolderSet' in h) cwFolderSet = h.cwFolderSet;
    if ('cwGoBack' in h) cwGoBack = h.cwGoBack;
    if ('cwGoToStep2' in h) cwGoToStep2 = h.cwGoToStep2;
    if ('cwNameInput' in h) cwNameInput = h.cwNameInput;
    if ('cwOpenRow' in h) cwOpenRow = h.cwOpenRow;
    if ('cwSelectGrade' in h) cwSelectGrade = h.cwSelectGrade;
    if ('cwSetRollup' in h) cwSetRollup = h.cwSetRollup;
    if ('cwSkipToCustom' in h) cwSkipToCustom = h.cwSkipToCustom;
    if ('cwToggleCourse' in h) cwToggleCourse = h.cwToggleCourse;
    if ('cwTogglePreset' in h) cwTogglePreset = h.cwTogglePreset;
    if ('openClassManager' in h) openClassManager = h.openClassManager;
    if ('readBlockPicker' in h) readBlockPicker = h.readBlockPicker;
    if ('renderClassManager' in h) renderClassManager = h.renderClassManager;
    if ('state' in h) state = h.state;
    if ('_cmCloseStdMenus' in h) _cmCloseStdMenus = h._cmCloseStdMenus;
    if ('cmAddTag' in h) cmAddTag = h.cmAddTag;
    if ('cmCancelCreate' in h) cmCancelCreate = h.cmCancelCreate;
    if ('cmCompReviewApply' in h) cmCompReviewApply = h.cmCompReviewApply;
    if ('cmCompReviewCancel' in h) cmCompReviewCancel = h.cmCompReviewCancel;
    if ('cmCompReviewPick' in h) cmCompReviewPick = h.cmCompReviewPick;
    if ('cmCompReviewShowSame' in h) cmCompReviewShowSame = h.cmCompReviewShowSame;
    if ('cmCompReviewToggle' in h) cmCompReviewToggle = h.cmCompReviewToggle;
    if ('cmCreateToggle' in h) cmCreateToggle = h.cmCreateToggle;
    if ('cmDeleteStd' in h) cmDeleteStd = h.cmDeleteStd;
    if ('cmDeleteTag' in h) cmDeleteTag = h.cmDeleteTag;
    if ('cmDeleteWithdrawn' in h) cmDeleteWithdrawn = h.cmDeleteWithdrawn;
    if ('cmIcanAdd' in h) cmIcanAdd = h.cmIcanAdd;
    if ('cmIcanDelete' in h) cmIcanDelete = h.cmIcanDelete;
    if ('cmIcanEdit' in h) cmIcanEdit = h.cmIcanEdit;
    if ('cmLevelsCancel' in h) cmLevelsCancel = h.cmLevelsCancel;
    if ('cmLevelsDraft' in h) cmLevelsDraft = h.cmLevelsDraft;
    if ('cmLevelsEdit' in h) cmLevelsEdit = h.cmLevelsEdit;
    if ('cmLevelsSave' in h) cmLevelsSave = h.cmLevelsSave;
    if ('cmReenrolStudent' in h) cmReenrolStudent = h.cmReenrolStudent;
    if ('cmRelinkCancel' in h) cmRelinkCancel = h.cmRelinkCancel;
    if ('cmRelinkNext' in h) cmRelinkNext = h.cmRelinkNext;
    if ('cmSelectClass' in h) cmSelectClass = h.cmSelectClass;
    if ('cmStartCreate' in h) cmStartCreate = h.cmStartCreate;
    if ('cmStartRelink' in h) cmStartRelink = h.cmStartRelink;
    if ('cmStdCodeLive' in h) cmStdCodeLive = h.cmStdCodeLive;
    if ('cmStdEditWording' in h) cmStdEditWording = h.cmStdEditWording;
    if ('cmStdFinishWording' in h) cmStdFinishWording = h.cmStdFinishWording;
    if ('cmStdLabelLive' in h) cmStdLabelLive = h.cmStdLabelLive;
    if ('cmStdRestoreWording' in h) cmStdRestoreWording = h.cmStdRestoreWording;
    if ('cmStdToggleMenu' in h) cmStdToggleMenu = h.cmStdToggleMenu;
    if ('cmToggleStdCard' in h) cmToggleStdCard = h.cmToggleStdCard;
    if ('cmToggleStdFolder' in h) cmToggleStdFolder = h.cmToggleStdFolder;
    if ('cmUpdateStdCode' in h) cmUpdateStdCode = h.cmUpdateStdCode;
    if ('cmUpdateStdLabel' in h) cmUpdateStdLabel = h.cmUpdateStdLabel;
    if ('cmUpdateTagLabel' in h) cmUpdateTagLabel = h.cmUpdateTagLabel;
    if ('cmUpdateTagText' in h) cmUpdateTagText = h.cmUpdateTagText;
    if ('cwGradeInput' in h) cwGradeInput = h.cwGradeInput;
  }

  /* ── Action dispatcher (called from parent's _handleClick) ── */
  function handleAction(action, el, e) {
    state._cmKeepFocusSel = null;
    // Any click other than on a card's More button closes its open menu.
    if (action !== 'cmStdMenu') _cmCloseStdMenus();
    if (action !== 'cmRosterDesigOpen') _cmCloseRosterPicker();
    if (/^sq[A-Z]/.test(action) && typeof CmQuestionnaires !== 'undefined')
      return CmQuestionnaires.handleAction(action, el);
    if (/^sp[A-Z]/.test(action) && _cmTabShown('student-page', state.cmSelectedCourse))
      return CmStudentPage.handleAction(action, el);
    if (/^cmTerm[A-Z]/.test(action) && CmTerms.handleAction(action, el)) return true;
    var handlers = {
      openClassManager: function () {
        openClassManager();
      },
      closeClassManager: function () {
        closeClassManager();
      },
      cmStartCreate: function () {
        cmStartCreate();
      },
      cmOpenDemoMode: function () {
        cmOpenDemoMode();
      },
      cmCancelCreate: function () {
        cmCancelCreate();
      },
      cmSelectClass: function () {
        cmSelectClass(el.dataset.cid);
      },
      cmRemoveStudent: function () {
        cmRemoveStudent(el.dataset.sid);
      },
      cmOpenStudentPage: function () {
        cmOpenStudentPage(el.dataset.sid);
      },
      cmRosterSort: function () {
        cmRosterSort(el.dataset.sort);
      },
      cmRosterDesigOpen: function () {
        cmRosterDesigOpen(el);
      },
      cmRosterDesigAdd: function () {
        cmRosterDesigAdd(el.dataset.sid, el.dataset.code);
      },
      cmRosterDesigRemove: function () {
        cmRosterDesigRemove(el.dataset.sid, el.dataset.code);
      },
      cmReenrolStudent: function () {
        cmReenrolStudent(el.dataset.sid);
      },
      cmDeleteWithdrawn: function () {
        cmDeleteWithdrawn(el.dataset.sid);
      },
      cmCancelStudent: function () {
        cmCloseAddStudent();
      },
      cmSaveStudent: function () {
        cmSaveStudent(false);
      },
      cmSaveStudentAndAnother: function () {
        cmSaveStudent(true);
      },
      cmShowAddStudent: function () {
        cmShowAddStudent();
      },
      cmImportRoster: function () {
        cmImportRoster();
      },
      cmChooseRosterFile: function () {
        cmChooseRosterFile();
      },
      cmCloseImportFormat: function () {
        cmCloseImportFormat();
      },
      cmConfirmImport: function () {
        cmConfirmImport();
      },
      cmCancelImport: function () {
        cmCancelImport();
      },
      cmImportPick: function () {
        _cmCloseStdMenus();
        cmImportPick(el.dataset.col, el.dataset.field);
      },
      cmImportDateOrder: function () {
        cmImportDateOrder(el.dataset.col, el.dataset.order);
      },
      cmImportShowColumns: function () {
        cmImportShowColumns();
      },
      cmImportShowAll: function () {
        cmImportShowAll();
      },
      cmImportChooseNames: function () {
        cmImportChooseNames();
      },
      cmImportShowBlanks: function () {
        cmImportShowBlanks();
      },
      cmCloseImportDone: function () {
        cmCloseImportDone();
      },
      cmUndoImport: function () {
        cmUndoImport();
      },
      cmSetGradingSystem: function () {
        cmSetGradingSystem(el.dataset.value);
      },
      cmSetCalcMethod: function () {
        cmSetCalcMethod(el.dataset.value);
      },
      cmSetRoundPercent: function () {
        cmSetRoundPercent(el.dataset.value);
      },
      cmSetLevelOrder: function () {
        cmSetLevelOrder(el.dataset.value);
      },
      cmCatAdd: function () {
        cmCatAdd();
      },
      cmCatNoticeDone: function () {
        cmCatNoticeDone();
      },
      cmCatCopyFrom: function () {
        cmOpenSetupCopy({ mode: 'from', only: 'categories' });
      },
      cmCopySetup: function () {
        cmOpenSetupCopy({});
      },
      cmPointsScaleReset: function () {
        cmResetPointsScale();
      },
      cmPointsScaleMatch: function () {
        cmMatchPointsScale();
      },
      cmPointsScaleBc: function () {
        cmBcPointsScale();
      },
      cmPtsPick: function () {
        cmPtsPick(el);
      },
      cmCatSave: function () {
        cmCatSave();
      },
      cmCatDelete: function () {
        cmCatDelete(parseInt(el.dataset.idx, 10));
      },
      cmCatMoveCancel: function () {
        cmCatMoveCancel();
      },
      cmCatMoveDelete: function () {
        cmCatMoveDelete(parseInt(el.dataset.idx, 10));
      },
      cmCatAssignUncategorized: function () {
        cmCatAssignUncategorized();
      },
      cmToggleColorPalette: function () {
        cmToggleColorPalette(el);
      },
      cmPickColor: function () {
        cmPickColor(el);
      },
      cmDeleteSubject: function () {
        cmDeleteSubject(el.dataset.subid);
      },
      cmAddSubject: function () {
        cmAddSubject();
      },
      cmDeleteStd: function () {
        cmDeleteStd(el.dataset.secid);
      },
      cmDeleteTag: function () {
        cmDeleteTag(el.dataset.secid, el.dataset.tagid);
      },
      cmAddTag: function () {
        cmAddTag(el.dataset.secid);
      },
      cmAddStd: function () {
        cmAddStd();
      },
      cmStartRelink: function () {
        cmStartRelink(el.dataset.cid);
      },
      cmDuplicateCourse: function () {
        cmDuplicateCourse(el.dataset.cid);
      },
      cmDownloadBackup: function () {
        cmDownloadBackup(el.dataset.cid);
      },
      cmRestoreBackup: function () {
        cmRestoreBackup();
      },
      cmToggleArchive: function () {
        cmToggleArchive(el.dataset.cid);
      },
      cmDeleteCourse: function () {
        cmDeleteCourse(el.dataset.cid);
      },
      cwSelectGrade: function () {
        cwSelectGrade(parseInt(el.dataset.grade, 10));
      },
      cwToggleCourse: function () {
        cwToggleCourse(el.dataset.tag);
      },
      cwSkipToCustom: function () {
        cwSkipToCustom();
      },
      cwGoToStep2: function () {
        cwGoToStep2();
      },
      cwTogglePreset: function () {
        cwTogglePreset(el.dataset.tag);
      },
      cwFolderAll: function () {
        cwFolderSet(el.dataset.tag, parseInt(el.dataset.idx, 10), true);
      },
      cwFolderNone: function () {
        cwFolderSet(el.dataset.tag, parseInt(el.dataset.idx, 10), false);
      },
      cwOpenRow: function () {
        cwOpenRow(el.dataset.row);
      },
      cwGoBack: function () {
        cwGoBack();
      },
      cwFinishCreate: function () {
        cwFinishCreate();
      },
      cmAddCompGroup: function () {
        cmAddCompGroup();
      },
      cmDeleteCompGroup: function () {
        cmDeleteCompGroup(el.dataset.grpid);
      },
      cmToggleStdCard: function () {
        cmToggleStdCard(el.dataset.secid);
      },
      cmStdHelp: function () {
        cmShowStdHelp(el.dataset.secid);
      },
      cmStdMenu: function () {
        cmStdToggleMenu(el);
      },
      cmSetTab: function () {
        cmSetTab(el.dataset.tab);
      },
      cmOpenGradebook: function () {
        cmOpenGradebook(el.dataset.cid);
      },
      cmStdEditWording: function () {
        cmStdEditWording(el.dataset.secid);
      },
      cmLevelsEdit: function () {
        cmLevelsEdit(el.dataset.secid);
      },
      cmLevelsCancel: function () {
        cmLevelsCancel(el.dataset.secid);
      },
      cmLevelsSave: function () {
        cmLevelsSave(el.dataset.secid);
      },
      cmStdRestoreWording: function () {
        cmStdRestoreWording(el.dataset.secid);
      },
      cmIcanDelete: function () {
        cmIcanDelete(el.dataset.secid, Number(el.dataset.idx));
      },
      cmFolderCountChoice: function () {
        cmFolderCountChoice(el.dataset.grpid, el.dataset.value);
      },
      cmToggleStdFolder: function () {
        cmToggleStdFolder(el.dataset.uid);
      },
      cmOpenGroupColorPop: function () {
        cmOpenGroupColorPop(el);
      },
      cmBlockChip: function () {
        blockChipSelect(el);
        if (el.dataset.picker === 'cm-block') cmUpdateField('block', el.dataset.val || '');
        if (el.dataset.picker === 'cm-new-block') {
          state.cwStep2Block = el.dataset.val || '';
          _cwRailSync();
        }
      },
      cmCreateToggle: function () {
        cmCreateToggle(el, el.dataset.group);
        var dp = document.getElementById('cm-cg-decay');
        if (dp) dp.style.display = 'none';
      },
      cmCreateToggleDecay: function () {
        cmCreateToggle(el, el.dataset.group);
        /** @type {any} */ (document.getElementById('cm-cg-decay')).style.display =
          el.classList.contains('active') && el.dataset.val === 'decayingAvg' ? '' : 'none';
      },
      cmRelinkCancel: function () {
        cmRelinkCancel();
      },
      cmRelinkNext: function () {
        cmRelinkNext();
      },
      cmCompSelectStart: function () {
        cmCompSelectStart();
      },
      cmCompSelectDone: function () {
        cmCompSelectDone();
      },
      cmCompSelectAll: function () {
        cmCompSelectAll();
      },
      cmCompMove: function () {
        cmCompMove(el.dataset.grpid);
      },
      cmCompRemoveSelected: function () {
        cmCompRemoveSelected();
      },
      cmCompExport: function () {
        cmCompExport();
      },
      cmCompImport: function () {
        cmCompImport();
      },
      cmCompReviewShowSame: function () {
        cmCompReviewShowSame();
      },
      cmCompReviewCancel: function () {
        cmCompReviewCancel();
      },
      cmCompReviewApply: function () {
        cmCompReviewApply();
      },
    };
    // A folder's Counts as One switch sits on its header. A click there is
    // the switch's own: the folder stays as it is, and the click isn't
    // cancelled, which would undo the switch.
    if (action === 'cmToggleStdFolder' && e && e.target && e.target.closest && e.target.closest('.cm-folder-count'))
      return true;
    if (handlers[action]) {
      if (el.tagName !== 'SELECT' && e) e.preventDefault();
      handlers[action]();
      return true;
    }
    return false;
  }

  function handleInput(el) {
    if (el.dataset.actionInput === 'cwNameInput') {
      cwNameInput(el);
      return true;
    }
    if (el.dataset.actionInput === 'cmRosterSearch') {
      cmRosterSearch(el.value);
      return true;
    }
    if (el.dataset.actionInput === 'cmBlockOtherInput') {
      blockOtherInput(el);
      if (el.dataset.picker === 'cm-new-block') {
        state.cwStep2Block = readBlockPicker('cm-new-block');
        _cwRailSync();
      }
      return true;
    }
    if (el.dataset.actionInput === 'cmPtsLive') {
      cmPtsLive(el);
      return true;
    }
    if (el.dataset.actionInput === 'cmDecaySlider') {
      cmUpdateDecay(el.value);
      return true;
    }
    if (el.dataset.actionInput === 'cwFind') {
      cwFindInput(el.value);
      return true;
    }
    if (el.dataset.actionInput === 'cwGradeInput') {
      cwGradeInput(el.value);
      return true;
    }
    if (el.dataset.actionInput === 'cmCreateDecaySlider') {
      var dv = document.getElementById('cm-cg-decay-val');
      if (dv) dv.textContent = el.value + '%';
      return true;
    }
    if (el.dataset.actionInput === 'cmCatWeightLive') {
      cmCatWeightLive(parseInt(el.dataset.idx, 10), el.value);
      return true;
    }
    if (el.dataset.actionInput === 'cmCatNameLive') {
      cmCatNameLive(parseInt(el.dataset.idx, 10), el.value);
      return true;
    }
    if (el.dataset.actionInput === 'cmStdCodeLive') {
      cmStdCodeLive(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionInput === 'cmLevelsDraft') {
      cmLevelsDraft(el.dataset.secid, Number(el.dataset.level), el.value);
      return true;
    }
    if (el.dataset.actionInput === 'cmStdLabelLive') {
      cmStdLabelLive(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionInput === 'cmTermLive') {
      cmTermLive(parseInt(el.dataset.idx, 10), el.dataset.field, el.value);
      return true;
    }
    return false;
  }

  function handleChange(el) {
    state._cmKeepFocusSel = _cmControlSelector(el);
    return _handleChange(el);
  }

  function _cmRestoreKeptFocus() {
    if (!state._cmKeepFocusSel) return;
    var active = document.activeElement;
    if (active && active !== document.body) return;
    var again = document.querySelector(state._cmKeepFocusSel);
    if (again && typeof again.focus === 'function') again.focus({ preventScroll: true });
  }

  function _cmControlSelector(el) {
    if (!el || !el.tagName || typeof CSS === 'undefined' || !CSS.escape) return null;
    var keep = el.tagName === 'SELECT' || (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio'));
    if (!keep) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    var attrs = el.attributes || [];
    var parts = [];
    for (var i = 0; i < attrs.length; i++) {
      var n = attrs[i].name;
      if (n.indexOf('data-') === 0 || n === 'name' || (n === 'value' && el.type === 'radio'))
        parts.push('[' + n + '="' + CSS.escape(attrs[i].value) + '"]');
    }
    return parts.length ? el.tagName.toLowerCase() + parts.join('') : null;
  }

  function _handleChange(el) {
    if (typeof CmQuestionnaires !== 'undefined' && CmQuestionnaires.handleChange(el)) return true;
    if (_cmTabShown('student-page', state.cmSelectedCourse) && CmStudentPage.handleChange(el)) return true;
    if (el.dataset.actionChange === 'cmCSV') {
      cmHandleCSV(el);
      return true;
    }
    if (el.dataset.actionChange === 'cmCompCSV') {
      cmCompCSV(el);
      return true;
    }
    if (el.dataset.actionChange === 'cmCompToggle') {
      cmCompToggle(el.dataset.secid, el.checked);
      return true;
    }
    if (el.dataset.actionChange === 'cmCompReviewToggle') {
      cmCompReviewToggle(Number(el.dataset.idx), el.checked);
      return true;
    }
    if (el.dataset.actionChange === 'cmCompReviewPick') {
      cmCompReviewPick(el.dataset.group, Number(el.dataset.idx), el.dataset.pick);
      return true;
    }
    if (el.dataset.actionChange === 'cmImportToggle') {
      cmImportToggle(el.dataset.kind, Number(el.dataset.idx), el.checked);
      return true;
    }
    if (el.dataset.actionChange === 'cmImportToggleAll') {
      cmImportToggleAll(el.checked);
      return true;
    }
    if (el.dataset.actionChange === 'cmImportFix') {
      cmImportFix(el.dataset.line, el.dataset.field, el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmCheckStudent') {
      cmCheckStudent(el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmRoundPercentSelect') {
      cmRoundPercentSelect(el.value);
      return true;
    }
    // Letting go of the decay slider saves it and redraws the examples and the student check.
    if (el.dataset.actionChange === 'cmDecayCommit') {
      cmSaveDecay(el.value);
      renderClassManager();
      return true;
    }
    if (el.dataset.actionChange === 'cmTermSchool') {
      cmTermSchool(el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmSubjectColor') {
      cmUpdateSubjectColor(el.dataset.subid, el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmStdSubject') {
      cmUpdateStdSubject(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmStdColor') {
      cmUpdateStdColor(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmRecentLimit') {
      cmSetRecentLimit(el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmFoldersCountAsOne') {
      // How Folders Count's two choices.
      cmSetFoldersCountAsOne(el.type === 'radio' ? el.value === 'folder' : el.checked);
      return true;
    }
    if (el.dataset.actionChange === 'cwCompToggle') {
      cwCompToggle(el.dataset.key, el.checked);
      return true;
    }
    if (el.dataset.actionChange === 'cwRollup') {
      cwSetRollup(el.dataset.key, el.checked);
      return true;
    }
    if (el.dataset.actionChange === 'cmCoursesCountEqually') {
      cmSetCoursesCountEqually(el.checked);
      return true;
    }
    if (el.dataset.actionChange === 'cmFolderCountsAsOne') {
      cmSetFolderCountsAsOne(el.dataset.grpid, el.checked);
      return true;
    }
    if (el.dataset.actionChange === 'cmCatMode') {
      cmCatMode(parseInt(el.dataset.idx, 10), el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmPointsScale') {
      cmSavePointsScale(el);
      return true;
    }
    if (el.dataset.actionChange === 'cmStdGroup') {
      cmUpdateStdGroup(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmImportMap') {
      cmImportMap(el.dataset.col, el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmRosterEll') {
      cmRosterEll(el);
      return true;
    }
    return false;
  }

  // Enter in an Add/Edit Student field saves, as the Save button does.
  // In the starter editor Enter saves and Escape cancels.
  function handleKeydown(e) {
    var el = e.target;
    if (e.key === 'Escape' && _cmCloseStdMenus()) {
      var wrap = el && el.closest && el.closest('.cm-std-menu-wrap');
      var opener = wrap && wrap.querySelector('[aria-haspopup="menu"]');
      if (opener) opener.focus();
      e.preventDefault();
      return true;
    }
    if (e.key === 'Escape' && _cmCloseRosterPicker()) {
      e.preventDefault();
      return true;
    }
    if (e.key === 'Escape' && el && el.closest && el.closest('#cm-add-student-form') && cmCloseAddStudent()) {
      e.preventDefault();
      return true;
    }
    if (_cmRosterKeydown(e)) return true;
    if (_cmPtsKeydown(e) || CmGradingBars.keydown(e)) return true;
    // A course row in New Class or Re-link ticks with Space or Enter, and
    // keeps the focus through the redraw so the next row is one Tab away.
    if (
      el &&
      el.classList &&
      el.classList.contains('cw-course-item') &&
      (e.key === ' ' || e.key === 'Enter') &&
      !e.isComposing
    ) {
      e.preventDefault();
      var courseTag = el.dataset.tag;
      el.click();
      var again = document.querySelector('.cw-course-item[data-tag="' + CSS.escape(courseTag) + '"]');
      if (again) /** @type {any} */ (again).focus();
      return true;
    }
    // Arrow keys move between the class tabs, as in any tab list.
    if (el && el.classList && el.classList.contains('cm-tab') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      var ids = _cmShownTabs(state.cmSelectedCourse).map(function (t) {
        return t.id;
      });
      var at = ids.indexOf(el.dataset.tab);
      var next = ids[(at + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
      e.preventDefault();
      cmSetTab(next);
      return true;
    }
    if (el && el.classList && !e.isComposing && e.key === 'Enter' && !e.shiftKey) {
      // Enter adds the typed I Can statement, or ends an edit to one.
      if (el.classList.contains('cm-ican-new')) {
        e.preventDefault();
        var typed = el.value;
        el.value = ''; // so the blur that follows the redraw adds nothing twice
        cmIcanAdd(el.dataset.secid, typed);
        return true;
      }
      if (el.classList.contains('cm-ican-text')) {
        e.preventDefault();
        el.blur();
        return true;
      }
    }
    if (e.key !== 'Enter' || e.isComposing) return false;
    if (!el || el.tagName !== 'INPUT' || el.type === 'checkbox') return false;
    if (!el.closest || !el.closest('#cm-add-student-form')) return false;
    e.preventDefault();
    cmSaveStudent(true);
    return true;
  }

  function handleBlur(el) {
    if (typeof CmQuestionnaires !== 'undefined' && CmQuestionnaires.handleBlur(el)) return true;
    if (_cmTabShown('student-page', state.cmSelectedCourse) && CmStudentPage.handleBlur(el)) return true;
    if (el.dataset.actionBlur === 'cmRosterField') {
      cmRosterField(el);
      return true;
    }
    if (el.dataset.actionBlur === 'cmBlockOtherBlur') {
      var typed = normalizeCourseBlock(el.value);
      var cur = normalizeCourseBlock(COURSES[state.cmSelectedCourse] && COURSES[state.cmSelectedCourse].block);
      var isChip = COURSE_BLOCK_CHOICES.indexOf(cur) >= 0;
      // Leaving the box empty keeps a chosen chip; a typed label replaces it.
      if (typed) cmUpdateField('block', typed);
      else if (!isChip && cur) cmUpdateField('block', '');
      return true;
    }
    if (el.dataset.actionBlur === 'cmUpdateName') {
      cmUpdateField('name', el.value, el);
      return true;
    }
    if (el.dataset.actionBlur === 'cmUpdateGrade') {
      cmUpdateField('gradeLevel', el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmUpdateDesc') {
      cmUpdateField('description', el.value);
      return true;
    }
    // Late Work Policy — empty becomes null (matches Phoneox `value || null`
    // pattern, so blanking the textarea clears the server-side column).
    if (el.dataset.actionBlur === 'cmLateWorkPolicy') {
      var _lp = (el.value || '').trim();
      cmUpdateField('lateWorkPolicy', _lp || null);
      return true;
    }
    if (el.dataset.actionBlur === 'cmCompGroupName') {
      cmUpdateCompGroupName(el.dataset.grpid, el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmSubjectName') {
      cmUpdateSubjectName(el.dataset.subid, el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmStdCode') {
      cmUpdateStdCode(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmStdName') {
      cmUpdateStdName(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmStdLabel') {
      cmUpdateStdLabel(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmStdText') {
      cmStdFinishWording(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmIcanAdd') {
      // Typed but never pressed Enter: keep the statement anyway.
      if (el.value.trim()) cmIcanAdd(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmIcanEdit') {
      cmIcanEdit(el.dataset.secid, Number(el.dataset.idx), el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmTagLabel') {
      cmUpdateTagLabel(el.dataset.secid, el.dataset.tagid, el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmTagText') {
      cmUpdateTagText(el.dataset.secid, el.dataset.tagid, el.value);
      return true;
    }
    return false;
  }

  return {
    configure: configure,
    _cmRestoreKeptFocus: _cmRestoreKeptFocus,
    handleAction: handleAction,
    handleBlur: handleBlur,
    handleChange: handleChange,
    handleInput: handleInput,
    handleKeydown: handleKeydown,
  };
})();
