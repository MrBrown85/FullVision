/* dash-class-manager.js — Class manager + curriculum wizard (extracted from page-dashboard.js) */
window.DashClassManager = (function () {
  'use strict';

  /* What this file holds while its page is open: every variable that is
     assigned again as the teacher works. One object, so a part of this
     file that moves to its own file can be handed it once. */
  var state = {};
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
  var cwSetRollup = CmWizard.cwSetRollup;
  var cwSkipToCustom = CmWizard.cwSkipToCustom;
  var cwToggleCourse = CmWizard.cwToggleCourse;
  var cwTogglePreset = CmWizard.cwTogglePreset;
  var renderCmCreateForm = CmWizard.renderCmCreateForm;
  /* In cm-grading.js (moved 2026-11-26). */
  var CM_METHOD_TEXT = CmGrading.CM_METHOD_TEXT;
  var _cmEndedTerm = CmGrading._cmEndedTerm;
  var _cmMethodRule = CmGrading._cmMethodRule;
  var _cmPtsKeydown = CmGrading._cmPtsKeydown;
  var _cmRenderFoldersCountAsOne = CmGrading._cmRenderFoldersCountAsOne;
  var _cmRenderGradingTab = CmGrading._cmRenderGradingTab;
  var _initCmPtsDrag = CmGrading._initCmPtsDrag;
  var cmBcPointsScale = CmGrading.cmBcPointsScale;
  var cmCheckStudent = CmGrading.cmCheckStudent;
  var cmFolderCountChoice = CmGrading.cmFolderCountChoice;
  var cmMatchPointsScale = CmGrading.cmMatchPointsScale;
  var cmPtsLive = CmGrading.cmPtsLive;
  var cmPtsPick = CmGrading.cmPtsPick;
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
    _addDocListener: _addDocListener,
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
  state._cmLevelsBankAsked = false;
  state._cmIcanDrag = null;

  // The same code the gradebook heads the column with.
  function _cmStdCode(tag) {
    if (!tag) return '';
    return tag.code || (tag.id && !_UUID_RE_CM.test(tag.id) ? tag.id : '') || tag.shortName || '';
  }

  function _cmStdIsEdited(tag) {
    return !!(tag && tag.source_text && (tag.text || '').trim() !== tag.source_text.trim());
  }

  /* The read-only line under a competency's wording: where it came from.
     From the rebuilt bank, the course and the Ministry's own headings,
     looked up by its bank id ("BC Curriculum · Drafting 10 · Applied
     Design › Prototyping"); the bank loads the first time it's needed. From
     the old bank, its heading; hand-made, its category. */
  function _cmStdSource(sec, tag, subName) {
    if (tag.bank_id) {
      var place = _cmBankPlace(tag.bank_id);
      if (place)
        return ['BC Curriculum', place.course]
          .concat(place.path.length ? [place.path.join(' \u203A ')] : [])
          .join(' · ');
      return 'BC Curriculum' + (subName ? ' · ' + subName : '');
    }
    return (tag.source_text ? 'BC Curriculum' : 'Category') + (sec.name ? ' · ' + sec.name : '');
  }

  state._cmBankPlaces = null;
  state._cmBankPlacesOf = null;
  state._cmBankLoading = false;
  function _cmBankPlace(bankId) {
    if (!CURRICULUM_INDEX) {
      if (!state._cmBankLoading && typeof loadCurriculumIndex === 'function') {
        state._cmBankLoading = true;
        loadCurriculumIndex().then(function (idx) {
          state._cmBankLoading = false;
          if (idx && state.classManagerOpen && state.cmMode === 'edit') _cmRenderWithScroll();
        });
      }
      return null;
    }
    if (!state._cmBankPlaces || state._cmBankPlacesOf !== CURRICULUM_INDEX) {
      state._cmBankPlaces = {};
      state._cmBankPlacesOf = CURRICULUM_INDEX;
      Object.keys(CURRICULUM_INDEX).forEach(function (key) {
        var course = CURRICULUM_INDEX[key];
        (course.categories || []).forEach(function (cat) {
          var path = Array.isArray(cat.path) ? cat.path : cat.folder ? [cat.name] : [];
          (cat.competencies || []).forEach(function (comp) {
            if (comp.id) state._cmBankPlaces[comp.id] = { course: course.course_name, path: path };
          });
        });
      });
    }
    return state._cmBankPlaces[bankId] || null;
  }

  function _cmRenderStdCard(sec, lm, compGroups) {
    if (state.cmCompSelect) return _cmRenderStdSelectRow(sec);
    var tag = sec.tags[0] || {};
    var subs = lm.subjects || [];
    var sub = subs.find(function (s) {
      return s.id === sec.subject;
    });
    var subName = sub ? sub.name : '';
    var subColor = sub ? sub.color : 'var(--text-3)';
    // A card opened under its local id stays open once the id is re-keyed.
    var isOpen = _cmStdCardOpen(sec.id);
    var title = tag.label || sec.shortName || sec.name || '';
    var code = _cmStdCode(tag);
    var icans = tag.i_can_statements || [];
    var edited = _cmStdIsEdited(tag);
    var editing = !!_cmWordingEdit[sec.id];
    var chipColor = sec.color || subColor;
    var html =
      '<div class="cm-std-card' +
      (isOpen ? ' open' : '') +
      '" draggable="true" data-std-drag="' +
      sec.id +
      '" id="cm-std-' +
      sec.id +
      '">' +
      '<div class="cm-std-header" data-action="cmToggleStdCard" data-secid="' +
      sec.id +
      '">' +
      '<div class="cm-std-color-bar" style="background:' +
      sec.color +
      '"></div>' +
      // Always present (hidden when empty) so typing a code can fill it in.
      '<span class="cm-std-code" style="--chip:' +
      chipColor +
      '" data-fallback="' +
      esc(code) +
      '"' +
      (code ? '' : ' hidden') +
      '>' +
      esc(code) +
      '</span>' +
      '<span class="cm-std-titles"><span class="cm-std-label" data-fallback="' +
      esc(sec.shortName || sec.name || '') +
      '">' +
      esc(title) +
      '</span>' +
      // The wording's first line, so names that sound alike can be told
      // apart without opening the card.
      (tag.text ? '<span class="cm-std-line">' + esc(tag.text) + '</span>' : '') +
      '</span>' +
      '<span class="cm-std-meta">' +
      (edited ? '<span class="cm-std-flag">Wording Edited</span>' : '') +
      (icans.length ? '<span class="cm-std-count">' + icans.length + ' I Can</span>' : '') +
      '</span>' +
      '<span class="cm-std-tools" data-stop-prop="true">' +
      '<button type="button" class="cm-std-help-btn" data-action="cmStdHelp" data-secid="' +
      sec.id +
      '"><span class="cm-std-help-icon" aria-hidden="true">?</span>Where These Appear</button>' +
      '<span class="cm-std-menu-wrap">' +
      '<button type="button" class="cm-std-icon-btn" data-action="cmStdMenu" data-secid="' +
      sec.id +
      '" aria-label="More actions for ' +
      esc(title) +
      '" aria-haspopup="menu" aria-expanded="false">⋯</button>' +
      '<div class="cm-std-menu" role="menu" hidden>' +
      (edited
        ? '<button type="button" role="menuitem" class="cm-std-menu-item" data-action="cmStdRestoreWording" data-secid="' +
          sec.id +
          '">Restore Original Wording</button>'
        : '') +
      '<button type="button" role="menuitem" class="cm-std-menu-item danger" data-action="cmDeleteStd" data-secid="' +
      sec.id +
      '">Remove from Class…</button>' +
      '</div>' +
      '</span>' +
      '</span>' +
      '<span class="cm-std-chevron" aria-hidden="true">▸</span>' +
      '</div>' +
      '<div class="cm-std-body">' +
      '<div class="cm-std-row">' +
      '<div class="cm-std-field"><label class="cm-label" for="cm-std-title-' +
      sec.id +
      '">Title</label>' +
      '<input class="cm-input cm-std-title-input" id="cm-std-title-' +
      sec.id +
      '" value="' +
      esc(title) +
      '" data-stop-prop="true" data-action-input="cmStdLabelLive" data-action-blur="cmStdLabel" data-secid="' +
      sec.id +
      '"></div>' +
      '<div class="cm-std-field cm-std-field-code"><label class="cm-label" for="cm-std-code-' +
      sec.id +
      '">Code</label>' +
      '<input class="cm-input cm-std-code-input" id="cm-std-code-' +
      sec.id +
      '" value="' +
      esc(code) +
      '" maxlength="6" style="--chip:' +
      chipColor +
      '" data-stop-prop="true" data-action-input="cmStdCodeLive" data-action-blur="cmStdCode" data-secid="' +
      sec.id +
      '"></div>' +
      '</div>' +
      '<div class="cm-std-section">' +
      '<div class="cm-std-section-head">' +
      '<span class="cm-label cm-std-section-label" id="cm-std-wording-label-' +
      sec.id +
      '">Curricular Competency</span>' +
      (editing
        ? ''
        : '<button type="button" class="cm-std-link" data-action="cmStdEditWording" data-secid="' +
          sec.id +
          '">Edit Wording</button>') +
      '</div>' +
      (editing
        ? '<textarea class="cm-textarea cm-std-wording-input" aria-labelledby="cm-std-wording-label-' +
          sec.id +
          '" data-stop-prop="true" data-action-blur="cmStdText" data-secid="' +
          sec.id +
          '">' +
          esc(tag.text || '') +
          '</textarea>'
        : '<div class="cm-std-wording">' +
          (tag.text ? '<p>' + esc(tag.text) + '</p>' : '<p class="cm-std-wording-empty">No wording yet.</p>') +
          '<span class="cm-std-source">' +
          esc(_cmStdSource(sec, tag, subName)) +
          (edited ? ' · Edited' : '') +
          '</span>' +
          '</div>') +
      '</div>' +
      '<div class="cm-std-section">' +
      '<div class="cm-std-section-head"><span class="cm-label cm-std-section-label">I Can Statements</span></div>' +
      '<div class="cm-ican-list" data-secid="' +
      sec.id +
      '">' +
      icans
        .map(function (stmt, i) {
          return (
            '<div class="cm-ican-row" data-idx="' +
            i +
            '">' +
            '<span class="cm-ican-grip" draggable="true" data-secid="' +
            sec.id +
            '" data-idx="' +
            i +
            '" title="Drag to reorder" aria-hidden="true">⠿</span>' +
            '<textarea class="cm-ican-text" rows="' +
            Math.max(1, Math.ceil(String(stmt).length / 80)) +
            '" aria-label="I Can statement ' +
            (i + 1) +
            '" data-stop-prop="true" data-action-blur="cmIcanEdit" data-secid="' +
            sec.id +
            '" data-idx="' +
            i +
            '">' +
            esc(stmt) +
            '</textarea>' +
            '<button type="button" class="cm-ican-delete" data-action="cmIcanDelete" data-secid="' +
            sec.id +
            '" data-idx="' +
            i +
            '" aria-label="Delete this statement">✕</button>' +
            '</div>'
          );
        })
        .join('') +
      '<div class="cm-ican-row cm-ican-add">' +
      '<span class="cm-ican-plus" aria-hidden="true">+</span>' +
      '<input class="cm-ican-new" placeholder="Add a statement, then press Enter" aria-label="Add an I Can statement" data-stop-prop="true" data-action-blur="cmIcanAdd" data-secid="' +
      sec.id +
      '">' +
      '</div>' +
      '</div>' +
      _cmLevelsHtml(sec, tag) +
      // Where the statements print today: reports show the first one.
      (icans.length
        ? '<div class="cm-std-shown"><span class="cm-std-shown-label">Shown in:</span>' +
          '<span class="cm-std-shown-chip">Printed Reports \u00B7 first statement</span>' +
          '<span class="cm-std-shown-chip">Rubric Drafts</span>'
        : '<div class="cm-std-shown"><span class="cm-std-ican-none">No I Can statements yet. Reports print nothing for this competency until you add one.</span>') +
      '<button type="button" class="cm-add-link" data-action="cmStdHelp" data-secid="' +
      sec.id +
      '">Where These Appear</button></div>' +
      '</div>' +
      '<div class="cm-std-foot">' +
      (compGroups.length > 0
        ? '<label class="cm-label cm-std-foot-label" for="cm-std-folder-' +
          sec.id +
          '">Folder</label>' +
          '<select class="cm-input cm-std-foot-select" id="cm-std-folder-' +
          sec.id +
          '" data-stop-prop="true" data-action-change="cmStdGroup" data-secid="' +
          sec.id +
          '">' +
          '<option value="">None</option>' +
          compGroups
            .map(function (g) {
              return (
                '<option value="' +
                g.id +
                '"' +
                (sec.groupId === g.id ? ' selected' : '') +
                '>' +
                esc(g.name) +
                '</option>'
              );
            })
            .join('') +
          '</select>'
        : '') +
      (subs.length > 1
        ? '<label class="cm-label cm-std-foot-label" for="cm-std-course-' +
          sec.id +
          '">Course</label>' +
          '<select class="cm-input cm-std-foot-select" id="cm-std-course-' +
          sec.id +
          '" data-stop-prop="true" data-action-change="cmStdSubject" data-secid="' +
          sec.id +
          '">' +
          subs
            .map(function (s) {
              return (
                '<option value="' +
                s.id +
                '"' +
                (s.id === sec.subject ? ' selected' : '') +
                '>' +
                esc(s.name) +
                '</option>'
              );
            })
            .join('') +
          '</select>'
        : '') +
      '<span class="cm-label cm-std-foot-label">Colour</span>' +
      '<div class="cm-std-swatch-wrap">' +
      '<div class="cm-color-swatch-selected cm-std-swatch" style="background:' +
      sec.color +
      '" role="button" tabindex="0" aria-label="Change colour" data-action="cmToggleColorPalette" data-target="section" data-secid="' +
      sec.id +
      '"></div>' +
      '<div class="cm-color-palette" id="cm-palette-section-' +
      sec.id +
      '"></div>' +
      '</div>' +
      '</div>' +
      '</div></div>';
    return html;
  }

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

  function _cmStdCardOpen(secId) {
    return (
      !!state._cmOpenStdCards[secId] ||
      Object.keys(state._cmOpenStdCards).some(function (k) {
        return state._cmOpenStdCards[k] && k !== secId && _currentId('section', k) === secId;
      })
    );
  }

  function cmToggleStdCard(secId) {
    var open = !_cmStdCardOpen(secId);
    // Forget the key it was opened under before its id was re-keyed.
    Object.keys(state._cmOpenStdCards).forEach(function (k) {
      if (_currentId('section', k) === secId) delete state._cmOpenStdCards[k];
    });
    state._cmOpenStdCards[secId] = open;
    var card = document.getElementById('cm-std-' + secId);
    if (card) card.classList.toggle('open', open);
  }

  function cmToggleStdFolder(uid) {
    state._cmCollapsedStdFolders[uid] = !state._cmCollapsedStdFolders[uid];
    var folder = document.querySelector('.mod-folder[data-module-id="' + uid + '"]');
    if (folder) folder.classList.toggle('open', !state._cmCollapsedStdFolders[uid]);
  }

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

  var _UUID_RE_CM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

  function _cmClearMerge() {
    if (state._cmMergeHoverTimer) {
      clearTimeout(state._cmMergeHoverTimer);
      state._cmMergeHoverTimer = null;
    }
    if (state._cmMergeTargetId) {
      var el = document.getElementById('cm-std-' + state._cmMergeTargetId);
      if (el) el.classList.remove('merge-target');
    }
    state._cmMergeTargetId = null;
    state._cmMergeAnimating = false;
  }

  function _cmMergeToNewGroup(draggedId, targetId) {
    draggedId = _currentId('section', draggedId);
    targetId = _currentId('section', targetId);
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    if (!map.competencyGroups) map.competencyGroups = [];
    var idx = map.competencyGroups.length;
    var grp = {
      id: 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: 'Group ' + (idx + 1),
      color: CM_GROUP_COLORS[idx % CM_GROUP_COLORS.length],
      sortOrder: idx,
    };
    map.competencyGroups.push(grp);
    [draggedId, targetId].forEach(function (sid) {
      var sec = (map.sections || []).find(function (s) {
        return s.id === sid;
      });
      if (sec) sec.groupId = grp.id;
    });
    saveLearningMap(cid, map);
    renderClassManager();
    setTimeout(function () {
      var input = document.querySelector('.mod-folder[data-module-id="' + grp.id + '"] .mod-folder-name-input');
      if (input) {
        input.focus();
        input.select();
      }
    }, 50);
  }

  function _initCmStdDrag() {
    _addDocListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.cm-std-menu-wrap')) _cmCloseStdMenus();
    });
    // A class list dropped on Import Roster's drop place reads like Choose
    // File. Files dropped anywhere else are left to the browser.
    var dropZone = function (e) {
      var files = e.dataTransfer && e.dataTransfer.types;
      if (!files || Array.prototype.indexOf.call(files, 'Files') < 0) return null;
      return e.target.closest ? e.target.closest('.cm-import-drop') : null;
    };
    _addDocListener('dragover', function (e) {
      var zone = dropZone(e);
      if (!zone) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      zone.classList.add('is-over');
    });
    _addDocListener('dragleave', function (e) {
      var zone = e.target.closest && e.target.closest('.cm-import-drop');
      if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('is-over');
    });
    _addDocListener('drop', function (e) {
      var zone = dropZone(e);
      if (!zone) return;
      e.preventDefault();
      zone.classList.remove('is-over');
      var file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) cmHandleCSV({ files: [file], value: '' });
    });
    // The column menu: ↑ ↓ move through the choices, Escape closes it.
    _addDocListener('keydown', function (e) {
      var menu = e.target.closest && e.target.closest('.cm-import-field-menu');
      if (!menu) return;
      var items = Array.prototype.slice.call(menu.querySelectorAll('.cm-std-menu-item'));
      var at = items.indexOf(e.target);
      var to = -1;
      if (e.key === 'ArrowDown') to = (at + 1) % items.length;
      else if (e.key === 'ArrowUp') to = (at - 1 + items.length) % items.length;
      else if (e.key === 'Home') to = 0;
      else if (e.key === 'End') to = items.length - 1;
      else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        var btn = menu.parentElement.querySelector('[aria-haspopup="menu"]');
        _cmCloseStdMenus();
        if (btn) btn.focus();
        return;
      }
      if (to < 0) return;
      e.preventDefault();
      items[to].focus();
    });
    _addDocListener('dragstart', function (e) {
      // An I Can statement's grip reorders it within its own card.
      var grip = e.target.closest && e.target.closest('.cm-ican-grip');
      if (grip) {
        state._cmIcanDrag = { secId: grip.dataset.secid, idx: Number(grip.dataset.idx) };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'ican');
        var row = grip.closest('.cm-ican-row');
        if (row) row.classList.add('dragging');
        return;
      }
      var card = e.target.closest && e.target.closest('.cm-std-card[data-std-drag]');
      if (!card) return;
      state._cmDragStdId = card.dataset.stdDrag;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', state._cmDragStdId);
    });
    _addDocListener('dragover', function (e) {
      if (state._cmIcanDrag) {
        var over = e.target.closest && e.target.closest('.cm-ican-row[data-idx]');
        var list = over && over.closest('.cm-ican-list');
        document.querySelectorAll('.cm-ican-row.drop-target').forEach(function (r) {
          if (r !== over) r.classList.remove('drop-target');
        });
        if (over && list && list.dataset.secid === state._cmIcanDrag.secId) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          over.classList.add('drop-target');
        }
        return;
      }
      if (!state._cmDragStdId) return;
      var targetCard = e.target.closest && e.target.closest('.cm-std-card[data-std-drag]');
      if (targetCard) {
        var targetId = targetCard.dataset.stdDrag;
        if (targetId !== state._cmDragStdId) {
          var map = state.cmSelectedCourse ? getLearningMap(state.cmSelectedCourse) : null;
          var targetSec =
            map &&
            (map.sections || []).find(function (s) {
              return s.id === targetId;
            });
          if (targetSec && !targetSec.groupId) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (state._cmMergeTargetId === targetId) return;
            _cmClearMerge();
            state._cmMergeTargetId = targetId;
            state._cmMergeHoverTimer = setTimeout(function () {
              state._cmMergeAnimating = true;
              var el = document.getElementById('cm-std-' + targetId);
              if (el) el.classList.add('merge-target');
            }, 300);
            return;
          }
        }
      } else {
        if (state._cmMergeTargetId) _cmClearMerge();
      }
      var folder = e.target.closest && e.target.closest('.mod-folder[data-folder-drop]');
      if (!folder) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.mod-folder.drag-over').forEach(function (f) {
        f.classList.remove('drag-over');
      });
      folder.classList.add('drag-over');
      if (!folder.classList.contains('open')) folder.classList.add('open');
    });
    _addDocListener('dragleave', function (e) {
      if (!state._cmDragStdId) return;
      var targetCard = e.target.closest && e.target.closest('.cm-std-card[data-std-drag]');
      if (targetCard && !targetCard.contains(e.relatedTarget)) {
        if (state._cmMergeTargetId === targetCard.dataset.stdDrag) _cmClearMerge();
        return;
      }
      var folder = e.target.closest && e.target.closest('.mod-folder[data-folder-drop]');
      if (folder && !folder.contains(e.relatedTarget)) folder.classList.remove('drag-over');
    });
    _addDocListener('drop', function (e) {
      if (state._cmIcanDrag) {
        var onto = e.target.closest && e.target.closest('.cm-ican-row[data-idx]');
        var drag = state._cmIcanDrag;
        state._cmIcanDrag = null;
        if (!onto) return;
        e.preventDefault();
        cmIcanMove(drag.secId, drag.idx, Number(onto.dataset.idx));
        return;
      }
      if (!state._cmDragStdId) return;
      var targetCard = e.target.closest && e.target.closest('.cm-std-card[data-std-drag]');
      if (targetCard && state._cmMergeAnimating && state._cmMergeTargetId === targetCard.dataset.stdDrag) {
        e.preventDefault();
        e.stopPropagation();
        _cmMergeToNewGroup(state._cmDragStdId, targetCard.dataset.stdDrag);
        _cmClearMerge();
        state._cmDragStdId = null;
        document.querySelectorAll('.cm-std-card.dragging').forEach(function (c) {
          c.classList.remove('dragging');
        });
        return;
      }
      var folder = e.target.closest && e.target.closest('.mod-folder[data-folder-drop]');
      if (!folder) return;
      e.preventDefault();
      var targetGroupId = folder.dataset.folderDrop;
      if (targetGroupId === '__none__') targetGroupId = '';
      if (state.cmSelectedCourse) {
        var map = ensureCustomLearningMap(state.cmSelectedCourse);
        var dragId = _currentId('section', state._cmDragStdId);
        if (targetGroupId) targetGroupId = _currentId('group', targetGroupId);
        var sec = (map.sections || []).find(function (s) {
          return s.id === dragId;
        });
        if (sec) {
          if (targetGroupId) sec.groupId = targetGroupId;
          else delete sec.groupId;
          saveLearningMap(state.cmSelectedCourse, map);
          renderClassManager();
        }
      }
      state._cmDragStdId = null;
      document.querySelectorAll('.mod-folder.drag-over').forEach(function (f) {
        f.classList.remove('drag-over');
      });
      document.querySelectorAll('.cm-std-card.dragging').forEach(function (c) {
        c.classList.remove('dragging');
      });
    });
    _addDocListener('dragend', function () {
      state._cmIcanDrag = null;
      document.querySelectorAll('.cm-ican-row.dragging, .cm-ican-row.drop-target').forEach(function (r) {
        r.classList.remove('dragging', 'drop-target');
      });
      state._cmDragStdId = null;
      _cmClearMerge();
      document.querySelectorAll('.mod-folder.drag-over').forEach(function (f) {
        f.classList.remove('drag-over');
      });
      document.querySelectorAll('.cm-std-card.dragging').forEach(function (c) {
        c.classList.remove('dragging');
      });
    });
  }

  // Choose Competencies: bank ids the teacher unticked, the preset picked
  // in Choose Courses (Humanities 8), and the review's grading switches
  // (null: the default for one course or a combined class).
  state.cwSkipped = {};
  state.cwPreset = null;
  state.cwFoldersOn = null;
  state.cwCoursesEqual = null;
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

  function withdrawStudentUI(sid) {
    // The roster is rendered for cmSelectedCourse, which is not always the
    // dashboard's active course: cmSelectClass moves the manager's selection
    // on its own, and page-dashboard re-injects its own activeCourse through
    // CM.configure. Looking the student up in _activeCourse therefore searched
    // the wrong course, found nothing and returned here — the X button did
    // nothing at all. Every other roster action (add, edit, bulk, CSV import)
    // already keys off cmSelectedCourse; this was the lone outlier.
    // Capture the id once so the confirm and undo callbacks stay pinned to the
    // course the row belonged to even if the selection moves meanwhile.
    var cid = state.cmSelectedCourse;
    var students = getStudents(cid);
    var st = students.find(function (s) {
      return s.id === sid;
    });
    if (!st) return;
    var dname = displayName(st);
    showConfirm(
      'Withdraw student',
      'Withdraw ' +
        dname +
        ' from this class? They leave the roster, gradebook and reports. Their scores, observations and reports are kept, and you can re-enrol them from the Withdrawn list.',
      'Withdraw',
      'primary',
      function () {
        if (!withdrawStudent(cid, sid)) return;
        renderClassManager();
        showUndoToast(dname + ' withdrawn', function () {
          reenrolStudent(cid, sid);
          renderClassManager();
        });
      },
    );
  }

  function cmReenrolStudent(sid) {
    if (!state.cmSelectedCourse) return;
    if (reenrolStudent(state.cmSelectedCourse, sid)) renderClassManager();
  }

  /* S8-F1: who in class `cid` has photos of their work sent, { sid: true }
     (CmStudentPage.studentsWithPhotos, the one question). Empty, so every
     delete reads as it always has, while the class's build switch is off or
     nothing has been sent. Send Work is not asked: photos sent before it was
     turned off still go. */
  function _cmStudentsWithPhotos(cid) {
    return typeof CmStudentPage !== 'undefined' && CmStudentPage.studentsWithPhotos
      ? CmStudentPage.studentsWithPhotos(cid)
      : {};
  }

  /* The same, read from the server first when this session has not read the
     class's work (readStudentWorkForDelete; Send Work off reads nothing
     else), then then(who, maybe): maybe is true when that read failed, and
     the warning says photos go rather than miss them. At once when nothing
     needs reading. */
  function _cmPhotosBeforeDelete(cid, then) {
    var read = typeof readStudentWorkForDelete === 'function' ? readStudentWorkForDelete(cid) : null;
    if (!read) return then(_cmStudentsWithPhotos(cid), false);
    return read.then(function (res) {
      return then(_cmStudentsWithPhotos(cid), !(res && res.known));
    });
  }

  /* The second step: only a withdrawn student can be deleted, and the
     delete cannot be undone, so there is no Undo. */
  function cmDeleteWithdrawn(sid) {
    var cid = state.cmSelectedCourse;
    if (!cid) return;
    // Photos of their work go too (S8-F1, Colin's ruling 102).
    return _cmPhotosBeforeDelete(cid, function (who, maybe) {
      if (state.cmSelectedCourse !== cid) return;
      _cmConfirmDeleteWithdrawn(cid, sid, maybe || !!who[sid]);
    });
  }

  function _cmConfirmDeleteWithdrawn(cid, sid, photos) {
    var entry = getWithdrawnStudents(cid).find(function (w) {
      return w && w.student && w.student.id === sid;
    });
    if (!entry) return;
    var name = fullName(entry.student);
    showConfirm(
      'Delete ' + name + ' Permanently?',
      photos
        ? 'Their scores, observations, goals, reflections, reports and photos of their work in this class are deleted. This cannot be undone.'
        : 'Their scores, observations, goals, reflections and reports in this class are deleted. This cannot be undone.',
      'Delete Permanently',
      'danger',
      function () {
        if (deleteWithdrawnStudent(cid, sid)) renderClassManager();
      },
    );
    // Keep a copy first: a CSV of their scores and observations, offered
    // inside the dialog before the delete.
    var overlays = document.querySelectorAll('.confirm-overlay');
    var card = overlays.length && overlays[overlays.length - 1].querySelector('.confirm-card');
    var actions = card && card.querySelector('.confirm-actions');
    if (!actions) return;
    var keep = document.createElement('div');
    keep.className = 'cm-keep-copy';
    keep.innerHTML =
      '<span class="cm-keep-copy-text"><strong>Keep a copy first</strong><span>A CSV of ' +
      esc(name) +
      '’s scores and observations in ' +
      esc((COURSES[cid] && COURSES[cid].name) || 'this class') +
      '.</span>' +
      (photos ? '<span>Photos of their work are not in this file.</span>' : '') +
      '</span>' +
      '<button type="button" class="cm-action-btn" id="cm-keep-copy-btn">Download Records</button>';
    card.insertBefore(keep, actions);
    keep.querySelector('#cm-keep-copy-btn').addEventListener('click', function (e) {
      e.preventDefault();
      _cmDownloadWithdrawnRecords(cid, entry, e.currentTarget);
    });
  }

  /* The withdrawn student's records as CSV rows. This device's copy when it
     has one (it withdrew them, or Demo Mode); else the server's. */
  /* A score as the download shows it, the same whichever way the records
     came: "8 / 10", "Complete" or "Incomplete", or a proficiency ("3+"). */
  function _cmRecordScoreText(mode, value, maxPoints, mod) {
    if (value == null || value === '') return '';
    if (mode === 'complete') return Number(value) > 0 ? 'Complete' : 'Incomplete';
    if (mode === 'points') return value + ' / ' + (maxPoints != null ? maxPoints : '');
    return formatScoreLevel(Number(value), mod) || String(value);
  }

  function _cmWithdrawnRecordRows(cid, entry) {
    var rec = entry.records || {};
    var hasLocal = (rec.scores && rec.scores.length) || (rec.observations && rec.observations.length);
    if (hasLocal || !window.v2 || !window.v2.getWithdrawnStudentRecords) {
      var assess = {};
      getAssessments(cid).forEach(function (a) {
        assess[a.id] = a;
      });
      var tags = {};
      getAllTags(cid).forEach(function (t) {
        tags[t.id] = t;
      });
      var rows = (rec.scores || []).map(function (sc) {
        var a = assess[sc.assessmentId] || {};
        var t = tags[sc.tagId] || {};
        var status = rec.statuses ? rec.statuses[entry.student.id + ':' + sc.assessmentId] : '';
        return [
          'Score',
          sc.date || a.dueDate || a.date || '',
          a.title || '',
          t.label || '',
          _cmRecordScoreText(a.scoreMode || a.score_mode || 'proficiency', sc.score, a.maxPoints, sc.mod),
          status || '',
          sc.comment || '',
        ];
      });
      (rec.observations || []).forEach(function (o) {
        rows.push([
          'Observation',
          o.date || (o.created || '').slice(0, 10),
          '',
          '',
          '',
          o.sentiment || '',
          o.text || '',
        ]);
      });
      return Promise.resolve(rows);
    }
    return window.v2.getWithdrawnStudentRecords(entry.student.id).then(function (res) {
      if (res.error || !res.data) throw res.error || new Error('No records came back.');
      var d = res.data;
      var day = function (v) {
        return v ? String(v).slice(0, 10) : '';
      };
      var rows = [];
      (d.scores || []).forEach(function (r) {
        rows.push([
          'Score',
          day(r.date),
          r.assessment || '',
          '',
          _cmRecordScoreText(r.score_mode || 'proficiency', r.value, r.max_points, r.modifier),
          r.status || '',
          r.comment || '',
        ]);
      });
      (d.tag_scores || []).forEach(function (r) {
        rows.push([
          'Competency Score',
          day(r.date),
          r.assessment || '',
          r.competency || '',
          formatScoreLevel(r.value, r.modifier),
          '',
          '',
        ]);
      });
      (d.rubric_scores || []).forEach(function (r) {
        rows.push([
          'Rubric Score',
          day(r.date),
          r.assessment || '',
          r.criterion || '',
          formatScoreLevel(r.value, r.modifier),
          '',
          r.comment || '',
        ]);
      });
      (d.observations || []).forEach(function (r) {
        rows.push(['Observation', day(r.date), '', '', '', r.sentiment || '', r.body || '']);
      });
      return rows;
    });
  }

  function _cmDownloadWithdrawnRecords(cid, entry, btn) {
    if (btn) btn.disabled = true;
    _cmWithdrawnRecordRows(cid, entry)
      .then(function (rows) {
        var header = [
          'Record',
          'Date',
          'Assessment',
          'Competency or Criterion',
          'Score',
          'Status or Type',
          'Comment or Text',
        ];
        var csv = [header]
          .concat(rows)
          .map(function (r) {
            return r
              .map(function (c) {
                return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"';
              })
              .join(',');
          })
          .join('\n');
        var blob = new Blob([csv], { type: 'text/csv' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download =
          (fullName(entry.student) + '_' + ((COURSES[cid] && COURSES[cid].name) || 'class')).replace(/[^\w-]+/g, '_') +
          '_records.csv';
        a.click();
        URL.revokeObjectURL(url);
        if (btn) btn.textContent = 'Downloaded';
      })
      .catch(function () {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Try Again';
        }
      });
  }

  /* Withdrawn students, under the roster: when they left, Re-enrol, and
     the permanent delete. */
  function renderWithdrawnList(cid) {
    var list = getWithdrawnStudents(cid).filter(function (w) {
      return w && w.student && w.student.id;
    });
    if (!list.length) return '';
    var html =
      '<div class="cm-section cm-withdrawn" id="cm-withdrawn">' +
      '<div class="cm-withdrawn-title">Withdrawn <span class="cm-section-count">(' +
      list.length +
      ')</span></div>' +
      '<p class="cm-withdrawn-help">Their scores, observations and reports are kept. Re-enrol brings everything back.</p>' +
      '<div class="cm-student-list">';
    list.forEach(function (w) {
      var st = w.student;
      var when = w.withdrawnAt ? _cmWithdrawnDate(w.withdrawnAt) : '';
      html +=
        '<div class="cm-student-row cm-withdrawn-row" data-withdrawn-sid="' +
        esc(st.id) +
        '">' +
        '<span class="cm-student-name">' +
        esc(fullName(st)) +
        '</span>' +
        (st.studentNumber ? '<span class="cm-roster-num">' + esc(st.studentNumber) + '</span>' : '') +
        (when ? '<span class="cm-withdrawn-when">Withdrawn ' + esc(when) + '</span>' : '') +
        '<div class="cm-student-actions">' +
        '<button class="cm-add-link cm-withdrawn-btn" data-action="cmReenrolStudent" data-sid="' +
        esc(st.id) +
        '">Re-enrol</button>' +
        '<button class="cm-add-link cm-withdrawn-btn cm-withdrawn-delete" data-action="cmDeleteWithdrawn" data-sid="' +
        esc(st.id) +
        '">Delete Permanently\u2026</button>' +
        '</div>' +
        '</div>';
    });
    return html + '</div></div>';
  }

  function _cmWithdrawnDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  ROSTER_IMPORT_FIELDS.forEach(function (f) {
    _CM_FIELD_LABEL[f[0]] = f[1];
  });

  /* Points and Proficiency as one 0–100% ruler (Colin, 2026-11-06: the old
     two-column grid didn't speak for itself). Behind it, Points to
     Proficiency: four bands split where each proficiency starts, with a
     handle at each start. Above it, Counts As: a marker for every step (1 to
     4 with + and −) at the percent it counts as in the course %
     (docs/DECISIONS.md, "Proficiency percents" and "Counts As by step"). A
     step with no value of its own sits a third of the way between its whole
     levels and is drawn there. Picking a marker or handle opens one line to
     type its percent; Left and Right nudge it; a drag moves it. */
  state._cmPtsError = null;
  // The marker or handle picked: { cid, kind: 'step', key: '3+' } or
  // { cid, kind: 'edge', level: 2–4 } (where that proficiency starts).
  state._cmPtsPick = null;
  // What was typed when it was refused, shown back in the box.
  state._cmPtsTyped = null;

  // A marker or handle clicked: it is picked, or, picked already, let go.
  state._cmPtsDragEnd = 0;

  /* Dragging a marker or handle along the ruler: it snaps to 0.1 (a handle
     to 1), stays between its neighbours, and saves when let go. A press
     that doesn't move is a click. */
  state._cmPtsDrag = null;

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
    state.cwFoldersOn = null;
    state.cwCoursesEqual = null;
    state.cwLoadError = false;
    state.cwStep2Name = null;
    state.cwStep2Grade = '';
    state.cwStep2Block = '';
    state.cwStep2Span = 'full';
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
      _cwRailSync();
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
  var _cmTermDay = CmTerms._cmTermDay;
  var _cmDefaultReportingTerms = CmTerms._cmDefaultReportingTerms;
  CmWizard.configure({
    CALC_METHODS: CALC_METHODS,
    CW_PRESETS: CW_PRESETS,
    GRADING_SYSTEMS: GRADING_SYSTEMS,
    _cmDefaultReportingTerms: _cmDefaultReportingTerms,
    _cmTermDay: _cmTermDay,
  });
  var _cmRenderReportingTermsField = CmTerms._cmRenderReportingTermsField;
  CmOtherClasses.configure({
    _cmRenderReportingTermsField: _cmRenderReportingTermsField,
    _cmTermSchool: _cmTermSchool,
  });
  var cmTermSchool = CmTerms.cmTermSchool;
  var cmTermLive = CmTerms.cmTermLive;

  /* ── Re-link Curriculum ─────────────────────────────────── */
  function cmStartRelink(cid) {
    state.cmRelinkCid = cid;
    state.cmRelinkStep = 1;
    state.cwSelectedGrade = null;
    state.cwSelectedSubject = null;
    var course = COURSES[cid];
    state.cwSelectedTags = course && course.curriculumTags ? course.curriculumTags.slice() : [];
    state.cwLoadError = false;
    Promise.all([loadCurriculumIndex(), _cmLoadCrosswalk()]).then(function (got) {
      var idx = got[0];
      state.cwCurriculumLoaded = !!idx;
      state.cwLoadError = !idx;
      if (idx) state.cwSelectedTags = _cmRelinkTags(state.cwSelectedTags, got[1]);
      renderClassManager();
    });
    renderClassManager();
  }

  /* The courses Re-link starts with: the class's own, less any the bank
     dropped. A dropped course whose successors are settled (Humanities 8 →
     ELA 8 + SS 8) brings them in; the others are listed for the teacher. */
  function _cmRelinkTags(tags, cw) {
    var out = [];
    tags.forEach(function (k) {
      var note = cw && cw.courses && cw.courses[k];
      if (CURRICULUM_INDEX[k] || !note || !note.dropped) {
        if (CURRICULUM_INDEX[k] && out.indexOf(k) < 0) out.push(k);
        return;
      }
      if (note.decided)
        note.successors.forEach(function (s) {
          if (CURRICULUM_INDEX[s] && out.indexOf(s) < 0) out.push(s);
        });
    });
    return out;
  }

  /* The class's courses the bank no longer has, with what replaces them. */
  function _cmDroppedCourses(cid) {
    var cw = window._CURRICULUM_CROSSWALK || state._cmCrosswalk;
    var tags = (COURSES[cid] && COURSES[cid].curriculumTags) || [];
    return tags
      .filter(function (k) {
        return CURRICULUM_INDEX && !CURRICULUM_INDEX[k] && cw && cw.courses && cw.courses[k] && cw.courses[k].dropped;
      })
      .map(function (k) {
        return Object.assign({ key: k }, cw.courses[k]);
      });
  }

  function cmRelinkCancel() {
    state.cmRelinkCid = null;
    state.cmRelinkStep = 0;
    state.cwSelectedTags = [];
    renderClassManager();
  }

  function cmRelinkNext() {
    if (!state.cmRelinkCid || state.cwSelectedTags.length === 0) return;
    state.cmRelinkStep = 2;
    _cmOpenCompReview(state.cmRelinkCid, _cmCurriculumCands(state.cwSelectedTags), {
      kind: 'curriculum',
      tags: state.cwSelectedTags.slice(),
    });
  }

  function renderCmRelinkPanel(cid) {
    var html = '';

    if (state.cmRelinkStep === 1) {
      html += '<div class="cm-section"><div class="cm-section-title">Re-link to BC Curriculum</div>';

      if (!state.cwCurriculumLoaded && !state.cwLoadError) {
        html += '<div class="cw-empty-msg">Loading BC Curriculum data\u2026</div>';
      } else if (state.cwLoadError) {
        html += '<div class="cw-empty-msg">Could not load BC Curriculum data.</div>';
      } else {
        _cmDroppedCourses(cid).forEach(function (d) {
          var names = d.successors
            .filter(function (k) {
              return CURRICULUM_INDEX[k];
            })
            .map(function (k) {
              return CURRICULUM_INDEX[k].course_name;
            });
          html +=
            '<div class="cm-hint cm-relink-dropped">' +
            esc(d.name) +
            ' is no longer a BC curriculum course. ' +
            (d.decided
              ? 'Its courses are ticked below: ' + esc(names.join(' and ')) + '.'
              : names.length
                ? 'The courses that replace it: ' + esc(names.join(', ')) + '. Tick the ones this class teaches.'
                : '') +
            '</div>';
        });
        html += '<div class="cm-field"><label class="cm-label">Grade</label><div class="cw-grade-row">';
        [8, 9, 10, 11, 12].forEach(function (g) {
          html +=
            '<button class="cw-grade-btn' +
            (state.cwSelectedGrade === g ? ' active' : '') +
            '" aria-pressed="' +
            (state.cwSelectedGrade === g) +
            '" data-action="cwSelectGrade" data-grade="' +
            g +
            '">Grade ' +
            g +
            '</button>';
        });
        html += '</div></div>';

        if (state.cwSelectedGrade) {
          var subjects = getSubjectsByGrade(state.cwSelectedGrade);
          html += '<div class="cm-field"><label class="cm-label">Subject</label><div class="cw-subject-row">';
          subjects.forEach(function (s) {
            html +=
              '<button class="cw-subject-btn' +
              (state.cwSelectedSubject === s ? ' active' : '') +
              '" aria-pressed="' +
              (state.cwSelectedSubject === s) +
              '" data-action="cwSelectSubject" data-subject="' +
              esc(s) +
              '">' +
              esc(s) +
              '</button>';
          });
          html += '</div></div>';

          var courses = getCoursesByGrade(state.cwSelectedGrade);
          if (state.cwSelectedSubject)
            courses = courses.filter(function (c) {
              return c.subject === state.cwSelectedSubject;
            });

          if (courses.length > 0) {
            html += '<div class="cm-field"><label class="cm-label">Courses</label><div class="cw-course-list">';
            courses.forEach(function (c) {
              var sel = state.cwSelectedTags.includes(c.short_tag) ? ' selected' : '';
              // Counted and named as the New Class wizard's course rows.
              var counts = _cwCourseCounts([c.short_tag]);
              html +=
                '<div class="cw-course-item' +
                sel +
                '" role="checkbox" tabindex="0" aria-checked="' +
                (sel ? 'true' : 'false') +
                '" data-action="cwToggleCourse" data-tag="' +
                esc(c.short_tag) +
                '">' +
                '<span class="cw-course-check">' +
                (sel ? '\u2713' : '') +
                '</span>' +
                '<span class="cw-course-name">' +
                esc(c.course_name) +
                '</span>' +
                '<span class="cw-course-tag">' +
                esc(c.short_tag) +
                '</span>' +
                '<span class="cw-course-count">' +
                counts.competencies +
                (counts.competencies === 1 ? ' Competency' : ' Competencies') +
                (counts.folders ? ' \u00B7 ' + counts.folders + (counts.folders === 1 ? ' Folder' : ' Folders') : '') +
                '</span>' +
                '</div>';
            });
            html += '</div></div>';
          }
        }

        if (state.cwSelectedTags.length > 0) {
          var totalComps = 0;
          state.cwSelectedTags.forEach(function (tag) {
            var full = CURRICULUM_INDEX[tag];
            if (full && full.categories) {
              full.categories.forEach(function (cat) {
                totalComps += (cat.competencies || []).length;
              });
            }
          });
          html +=
            '<div class="cw-selection-summary"><strong>' +
            state.cwSelectedTags.length +
            '</strong> course' +
            (state.cwSelectedTags.length !== 1 ? 's' : '') +
            ' selected \u00B7 <strong>' +
            totalComps +
            '</strong> competencies</div>';
        }
      }

      html +=
        '<div class="cm-relink-actions">' +
        '<button class="btn btn-ghost" data-action="cmRelinkCancel">Cancel</button>' +
        '<button class="btn btn-primary" data-action="cmRelinkNext"' +
        (state.cwSelectedTags.length === 0 ? ' disabled style="opacity:0.5;pointer-events:none"' : '') +
        '>Next</button>' +
        '</div></div>';
    } else if (state.cmRelinkStep === 2) {
      html += _cmRenderCompReview(cid);
    }

    return html;
  }

  /* ── CM Curriculum Editing ──────────────────────────────── */
  function cmAddSubject() {
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var id = 'subj' + Date.now().toString(36);
    map.subjects.push({ id: id, name: 'New Subject', color: '#6366f1' });
    saveLearningMap(cid, map);
    renderClassManager();
  }

  function cmUpdateSubjectName(subId, val) {
    subId = _currentId('subject', subId);
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var sub = map.subjects.find(function (s) {
      return s.id === subId;
    });
    if (sub) {
      sub.name = val.trim();
      saveLearningMap(cid, map);
    }
  }

  function cmUpdateSubjectColor(subId, color) {
    subId = _currentId('subject', subId);
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var sub = map.subjects.find(function (s) {
      return s.id === subId;
    });
    if (sub) {
      sub.color = color;
      saveLearningMap(cid, map);
      renderClassManager();
    }
  }

  function cmToggleColorPalette(el) {
    var target = el.dataset.target;
    var id = target === 'subject' ? el.dataset.subid : el.dataset.secid;
    var paletteId = 'cm-palette-' + target + '-' + id;
    var palette = document.getElementById(paletteId);
    if (!palette) return;
    // Close any other open palettes
    document.querySelectorAll('.cm-color-palette.open').forEach(function (p) {
      if (p.id !== paletteId) p.classList.remove('open');
      p.innerHTML = '';
    });
    if (palette.classList.contains('open')) {
      palette.classList.remove('open');
      palette.innerHTML = '';
      return;
    }
    var html = '';
    CM_COLORS.forEach(function (c) {
      html +=
        '<div class="cm-color-dot" data-action="cmPickColor" data-target="' +
        target +
        '" data-id="' +
        id +
        '" data-color="' +
        c +
        '" style="background:' +
        c +
        '"></div>';
    });
    // html-safe: CM_COLORS are fixed; target and id are our own data attributes ('section'/'subject' and ids).
    palette.innerHTML = html;
    palette.classList.add('open');
  }

  function cmPickColor(el) {
    var target = el.dataset.target;
    var id = _currentId(el.dataset.target === 'subject' ? 'subject' : 'section', el.dataset.id);
    var color = el.dataset.color;
    if (!state.cmSelectedCourse) return;
    var map = ensureCustomLearningMap(state.cmSelectedCourse);
    if (target === 'subject') {
      var sub = map.subjects.find(function (s) {
        return s.id === id;
      });
      if (sub) {
        sub.color = color;
      }
    } else {
      var sec = map.sections.find(function (s) {
        return s.id === id;
      });
      if (sec) {
        sec.color = color;
      }
    }
    saveLearningMap(state.cmSelectedCourse, map);
    renderClassManager();
  }

  function cmDeleteSubject(subId) {
    subId = _currentId('subject', subId);
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var sectionCount = map.sections.filter(function (s) {
      return s.subject === subId;
    }).length;
    if (sectionCount > 0) {
      showConfirm(
        'Delete Subject',
        'This subject has ' + sectionCount + ' section(s). Delete them too?',
        'Delete All',
        'danger',
        function () {
          map.subjects = map.subjects.filter(function (s) {
            return s.id !== subId;
          });
          map.sections = map.sections.filter(function (s) {
            return s.subject !== subId;
          });
          saveLearningMap(cid, map);
          renderClassManager();
        },
      );
    } else {
      map.subjects = map.subjects.filter(function (s) {
        return s.id !== subId;
      });
      saveLearningMap(cid, map);
      renderClassManager();
    }
  }

  // ── Competency Group CRUD ──────────────────────────────────
  function cmAddCompGroup() {
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    if (!map.competencyGroups) map.competencyGroups = [];
    var idx = map.competencyGroups.length;
    var colors = [
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
    var grpLocalId = 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    var grpName = 'Group ' + (idx + 1);
    var grpColor = colors[idx % colors.length];
    map.competencyGroups.push({ id: grpLocalId, name: grpName, color: grpColor, sortOrder: idx });
    saveLearningMap(cid, map);
    renderClassManager();
  }

  function cmUpdateCompGroupName(grpId, val) {
    grpId = _currentId('group', grpId);
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var g = (map.competencyGroups || []).find(function (x) {
      return x.id === grpId;
    });
    if (g && val.trim()) {
      g.name = val.trim();
      saveLearningMap(cid, map);
    }
  }

  /* Competency group colour: the swatch opens the shared colour popover (ui.js). */
  function cmOpenGroupColorPop(swatch) {
    var grpId = swatch.dataset.grpid;
    var map = state.cmSelectedCourse && getLearningMap(state.cmSelectedCourse);
    var g = ((map && map.competencyGroups) || []).find(function (x) {
      return x.id === _currentId('group', grpId);
    });
    if (!g) return;
    openColorPop(swatch, {
      key: 'group:' + grpId,
      colors: CM_GROUP_COLORS,
      current: g.color,
      label: 'Group colour',
      findSwatch: function () {
        return document.querySelector('.mod-folder-color[data-grpid="' + grpId + '"]');
      },
      onPick: function (color) {
        cmUpdateCompGroupColor(grpId, color);
      },
    });
  }
  function cmUpdateCompGroupColor(grpId, color) {
    grpId = _currentId('group', grpId);
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var g = (map.competencyGroups || []).find(function (x) {
      return x.id === grpId;
    });
    if (g) {
      g.color = color;
      saveLearningMap(cid, map);
      _cmRenderWithScroll();
    }
  }

  function cmDeleteCompGroup(grpId) {
    grpId = _currentId('group', grpId);
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var count = (map.sections || []).filter(function (s) {
      return s.groupId === grpId;
    }).length;
    var doDelete = function () {
      map.competencyGroups = (map.competencyGroups || []).filter(function (g) {
        return g.id !== grpId;
      });
      (map.sections || []).forEach(function (s) {
        if (s.groupId === grpId) delete s.groupId;
      });
      saveLearningMap(cid, map);
      _cmRenderWithScroll();
    };
    if (count > 0) {
      showConfirm(
        'Delete Group',
        count + ' competencies will leave this folder. Delete anyway?',
        'Delete',
        'danger',
        doDelete,
      );
    } else {
      doDelete();
    }
  }

  function cmUpdateStdGroup(secId, groupId) {
    secId = _currentId('section', secId);
    groupId = _currentId('group', groupId);
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var sec = (map.sections || []).find(function (s) {
      return s.id === secId;
    });
    if (!sec) return;
    if (groupId) sec.groupId = groupId;
    else delete sec.groupId;
    saveLearningMap(cid, map);
    _cmRenderWithScroll();
  }

  // Redraw, then put keyboard focus back on the control that caused it: a
  // checkbox or radio is a new element after the redraw, and focus would
  // otherwise fall back to the page.
  function _cmAttr(v) {
    return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  function _cmRenderAndFocus(sel) {
    renderClassManager();
    var el = sel && document.querySelector(sel);
    if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
  }

  // Re-render class manager preserving scroll position
  function _cmRenderWithScroll() {
    var container = document.querySelector('.cm-detail');
    var scrollY = container ? container.scrollTop : window.scrollY;
    renderClassManager();
    requestAnimationFrame(function () {
      var c = document.querySelector('.cm-detail');
      if (c) c.scrollTop = scrollY;
      else window.scrollTo(0, scrollY);
    });
  }

  // ── Flat Learning Standard CRUD ──────────────────────────────
  function cmAddStd() {
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    if (map.subjects.length === 0) {
      map.subjects.push({ id: 'subj1', name: 'General', color: '#6366f1' });
    }
    var subId = map.subjects[0].id;
    var stdId = 'S' + Date.now().toString(36).slice(-4).toUpperCase();
    var colour =
      map.subjects.find(function (s) {
        return s.id === subId;
      })?.color || '#6366f1';
    map.sections.push({
      id: stdId,
      subject: subId,
      name: 'New Competency',
      shortName: 'New',
      color: colour,
      tags: [
        {
          id: stdId,
          label: 'New Competency',
          text: '',
          color: colour,
          subject: subId,
          name: 'New Competency',
          shortName: 'New',
        },
      ],
    });
    map._flatVersion = 2;
    saveLearningMap(cid, map);
    // The new card opens with its Title ready to type over.
    state._cmOpenStdCards[stdId] = true;
    renderClassManager();
    requestAnimationFrame(function () {
      var id = _currentId('section', stdId);
      var card = document.getElementById('cm-std-' + id);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      var title = document.getElementById('cm-std-title-' + id);
      if (title) {
        title.focus({ preventScroll: true });
        if (typeof title.select === 'function') title.select();
      }
    });
  }

  function cmUpdateStdName(secId, val) {
    secId = _currentId('section', secId);
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var sec = map.sections.find(function (s) {
      return s.id === secId;
    });
    if (!sec) return;
    var trimmed = val.trim();
    sec.name = trimmed;
    sec.shortName = trimmed.split(' ')[0];
    if (sec.tags[0]) {
      sec.tags[0].name = trimmed;
      sec.tags[0].shortName = sec.shortName;
    }
    saveLearningMap(cid, map);
  }

  function cmUpdateStdSubject(secId, subId) {
    secId = _currentId('section', secId);
    subId = _currentId('subject', subId);
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var sec = map.sections.find(function (s) {
      return s.id === secId;
    });
    if (!sec) return;
    sec.subject = subId;
    if (sec.tags[0]) sec.tags[0].subject = subId;
    saveLearningMap(cid, map);
  }

  function cmUpdateStdColor(secId, color) {
    secId = _currentId('section', secId);
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var sec = map.sections.find(function (s) {
      return s.id === secId;
    });
    if (!sec) return;
    sec.color = color;
    if (sec.tags[0]) sec.tags[0].color = color;
    saveLearningMap(cid, map);
    renderClassManager();
  }

  /* ── Competencies toolbar, select mode, CSV ─────────────────
     Select picks several competencies to move into a folder or remove
     (scores kept). Import / Export writes the list as a CSV and reads one
     back through the same review Re-link uses, so nothing is added twice. */
  state.cmCompSelect = false;
  state.cmCompSelected = {};
  state.cmCompReview = null;

  var CM_COMP_CSV_HEADER = ['Code', 'Title', 'Curricular Competency', 'I Can Statements', 'Folder'];

  function _cmRenderCompToolbar(cid, lm, compGroups) {
    var secs = lm.sections || [];
    if (state.cmCompSelect) {
      var n = secs.filter(function (s) {
        return state.cmCompSelected[s.id];
      }).length;
      var off = n === 0 ? ' disabled' : '';
      return (
        '<div class="cm-comp-toolbar cm-comp-selectbar">' +
        '<span class="cm-comp-selected">' +
        n +
        ' Selected</span>' +
        '<button type="button" class="cm-add-link" data-action="cmCompSelectAll">Select All</button>' +
        '<div class="cm-comp-buttons">' +
        (compGroups.length
          ? '<div class="cm-std-menu-wrap">' +
            '<button type="button" class="cm-action-btn" data-action="cmStdMenu" aria-haspopup="menu" aria-expanded="false"' +
            off +
            '>Move to Folder \u25BE</button>' +
            '<div class="cm-std-menu" role="menu" hidden>' +
            compGroups
              .map(function (g) {
                return (
                  '<button type="button" role="menuitem" class="cm-std-menu-item" data-action="cmCompMove" data-grpid="' +
                  g.id +
                  '">' +
                  esc(g.name) +
                  '</button>'
                );
              })
              .join('') +
            '<button type="button" role="menuitem" class="cm-std-menu-item" data-action="cmCompMove" data-grpid="">Ungrouped</button>' +
            '</div>' +
            '</div>'
          : '') +
        '<button type="button" class="cm-action-btn cm-comp-remove" data-action="cmCompRemoveSelected"' +
        off +
        '>Remove\u2026</button>' +
        '<button type="button" class="cm-action-btn" data-action="cmCompSelectDone">Done</button>' +
        '</div>' +
        '</div>'
      );
    }
    return (
      '<div class="cm-comp-toolbar">' +
      '<div class="cm-hint">' +
      (secs.length
        ? 'Drag a competency to reorder it or move it into a folder.'
        : 'Add competencies one at a time, import a CSV, or link the class to the BC Curriculum.') +
      '</div>' +
      '<div class="cm-comp-buttons">' +
      (secs.length
        ? '<button type="button" class="cm-action-btn" data-action="cmCompSelectStart">Select</button>'
        : '') +
      '<div class="cm-std-menu-wrap">' +
      '<button type="button" class="cm-action-btn" data-action="cmStdMenu" aria-haspopup="menu" aria-expanded="false">Import / Export \u25BE</button>' +
      '<div class="cm-std-menu cm-comp-io-menu" role="menu" hidden>' +
      (secs.length
        ? '<button type="button" role="menuitem" class="cm-std-menu-item cm-comp-io-item" data-action="cmCompExport">' +
          '<span class="cm-comp-io-name">Export Competencies</span>' +
          '<span class="cm-comp-io-desc">A CSV file with Code, Title, Curricular Competency, I Can Statements and Folder.</span>' +
          '</button>'
        : '') +
      '<button type="button" role="menuitem" class="cm-std-menu-item cm-comp-io-item" data-action="cmCompImport">' +
      '<span class="cm-comp-io-name">Import From CSV\u2026</span>' +
      '<span class="cm-comp-io-desc">Same columns. You\u2019ll see what changes before anything is added, so nothing is duplicated.</span>' +
      '</button>' +
      '</div>' +
      '</div>' +
      '<button type="button" class="cm-action-btn" data-action="cmAddCompGroup">Add Folder</button>' +
      '<button type="button" class="btn btn-primary" data-action="cmAddStd">Add Competency</button>' +
      '<input type="file" id="cm-comp-csv-input" accept=".csv,.txt" style="display:none" data-action-change="cmCompCSV">' +
      '</div>' +
      '</div>'
    );
  }

  function _cmRenderStdSelectRow(sec) {
    var tag = sec.tags[0] || {};
    var title = tag.label || sec.shortName || sec.name || '';
    var code = _cmStdCode(tag);
    var icans = (tag.i_can_statements || []).length;
    var on = !!state.cmCompSelected[sec.id];
    return (
      '<label class="cm-comp-select-row' +
      (on ? ' selected' : '') +
      '">' +
      '<input type="checkbox"' +
      (on ? ' checked' : '') +
      ' aria-label="Select ' +
      esc(title) +
      '" data-action-change="cmCompToggle" data-secid="' +
      sec.id +
      '">' +
      (code ? '<span class="cm-std-code" style="--chip:' + sec.color + '">' + esc(code) + '</span>' : '') +
      '<span class="cm-std-label">' +
      esc(title) +
      '</span>' +
      (icans ? '<span class="cm-std-count">' + icans + ' I Can</span>' : '') +
      '</label>'
    );
  }

  function _cmCompTitle(sec) {
    var tag = (sec && sec.tags && sec.tags[0]) || {};
    return tag.label || sec.shortName || sec.name || '';
  }

  // "A", "A and B", "A, B and C"; past three, a count.
  function _cmJoinNames(names, noun) {
    if (names.length > 3) return names.length + ' ' + noun;
    if (names.length <= 1) return names[0] || '';
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  function cmCompSelectStart() {
    state.cmCompSelect = true;
    state.cmCompSelected = {};
    renderClassManager();
  }

  function cmCompSelectDone() {
    state.cmCompSelect = false;
    state.cmCompSelected = {};
    renderClassManager();
  }

  function cmCompSelectAll() {
    (getLearningMap(state.cmSelectedCourse).sections || []).forEach(function (s) {
      state.cmCompSelected[s.id] = true;
    });
    _cmRenderAndFocus('[data-action="cmCompSelectAll"]');
  }

  function cmCompToggle(secId, on) {
    if (on) state.cmCompSelected[secId] = true;
    else delete state.cmCompSelected[secId];
    _cmRenderAndFocus('[data-action-change="cmCompToggle"][data-secid=' + _cmAttr(secId) + ']');
  }

  function _cmCompSelectedSections() {
    return (getLearningMap(state.cmSelectedCourse).sections || []).filter(function (s) {
      return state.cmCompSelected[s.id];
    });
  }

  function cmCompMove(groupId) {
    var cid = state.cmSelectedCourse;
    if (!cid) return;
    groupId = groupId ? _currentId('group', groupId) : '';
    var ids = {};
    _cmCompSelectedSections().forEach(function (s) {
      ids[s.id] = true;
    });
    var map = ensureCustomLearningMap(cid);
    (map.sections || []).forEach(function (sec) {
      if (!ids[sec.id]) return;
      if (groupId) sec.groupId = groupId;
      else delete sec.groupId;
    });
    saveLearningMap(cid, map);
    _cmRenderWithScroll();
  }

  function cmCompRemoveSelected() {
    var secs = _cmCompSelectedSections();
    if (!secs.length) return;
    var names = secs.map(_cmCompTitle);
    showConfirm(
      secs.length === 1 ? 'Remove 1 Competency' : 'Remove ' + secs.length + ' Competencies',
      _cmRemoveMessage(
        state.cmSelectedCourse,
        secs.map(function (s) {
          return s.id;
        }),
        'Remove ' + _cmJoinNames(names, 'competencies') + ' from the class?',
      ),
      'Remove',
      'danger',
      function () {
        removeCompetencies(
          state.cmSelectedCourse,
          secs.map(function (s) {
            return _currentId('section', s.id);
          }),
        );
        state.cmCompSelected = {};
        if (!(getLearningMap(state.cmSelectedCourse).sections || []).length) state.cmCompSelect = false;
        renderClassManager();
      },
    );
  }

  function _cmCsvCell(v) {
    return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  }

  /* Rows of a CSV file. Quoted cells may hold commas, quotes ("") and line
     breaks. */
  function _cmParseCsv(text) {
    var rows = [];
    var row = [];
    var cell = '';
    var quoted = false;
    text = String(text || '').replace(/^﻿/, '');
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        row.push(cell);
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter(function (r) {
      return r.some(function (c) {
        return String(c).trim();
      });
    });
  }

  function _cmSplitIcans(v) {
    return String(v || '')
      .split(/\r?\n/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
  }

  function cmCompExport() {
    var cid = state.cmSelectedCourse;
    if (!cid) return;
    var lm = getLearningMap(cid);
    var groups = {};
    (lm.competencyGroups || []).forEach(function (g) {
      groups[g.id] = g.name;
    });
    var rows = [CM_COMP_CSV_HEADER].concat(
      (lm.sections || []).map(function (sec) {
        var tag = sec.tags[0] || {};
        return [
          _cmStdCode(tag),
          _cmCompTitle(sec),
          tag.text || '',
          (tag.i_can_statements || []).join('\n'),
          (sec.groupId && groups[sec.groupId]) || '',
        ];
      }),
    );
    var csv = rows
      .map(function (r) {
        return r.map(_cmCsvCell).join(',');
      })
      .join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = ((COURSES[cid] && COURSES[cid].name) || 'class').replace(/[^\w-]+/g, '_') + '_competencies.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function cmCompImport() {
    var el = document.getElementById('cm-comp-csv-input');
    if (el) el.click();
  }

  /* A CSV's rows as competencies to review. Columns are found by their
     headers (the export's); a file without them is read in the export's
     order. */
  function cmCompRowsFromCsv(text) {
    var rows = _cmParseCsv(text);
    if (!rows.length) return [];
    var head = rows[0].map(function (h) {
      return String(h).trim().toLowerCase();
    });
    function col(test) {
      return head.findIndex(test);
    }
    var at = {
      code: col(function (h) {
        return h === 'code';
      }),
      title: col(function (h) {
        return h === 'title' || h === 'name';
      }),
      text: col(function (h) {
        return h.indexOf('competency') >= 0 || h === 'wording';
      }),
      icans: col(function (h) {
        return h.indexOf('i can') >= 0;
      }),
      folder: col(function (h) {
        return h === 'folder' || h === 'group';
      }),
    };
    var hasHeader = at.title >= 0 || at.text >= 0;
    if (!hasHeader) at = { code: 0, title: 1, text: 2, icans: 3, folder: 4 };
    return rows
      .slice(hasHeader ? 1 : 0)
      .map(function (r) {
        function get(k) {
          return at[k] >= 0 ? String(r[at[k]] == null ? '' : r[at[k]]).trim() : '';
        }
        return {
          code: get('code'),
          label: get('title'),
          text: get('text'),
          icans: _cmSplitIcans(at.icans >= 0 ? r[at.icans] : ''),
          folder: get('folder'),
        };
      })
      .filter(function (c) {
        return c.label || c.text;
      });
  }

  function cmCompCSV(input) {
    var file = input.files && input.files[0];
    if (!file || !state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var reader = new FileReader();
    reader.onload = function (e) {
      input.value = '';
      var cands = cmCompRowsFromCsv(e.target.result);
      if (!cands.length) {
        showConfirm(
          'Nothing to Import',
          'No competencies were found in ' + file.name + '. The file needs a Title or Curricular Competency column.',
          'OK',
          'primary',
          function () {},
        );
        return;
      }
      _cmOpenCompReview(cid, cands, { kind: 'file', fileName: file.name });
    };
    reader.readAsText(file);
  }

  /* ── Review: Re-link and CSV import ─────────────────────────
     Each incoming competency is matched to the class by curriculum wording,
     then code, then title. Matched and identical: stays. Matched and
     different: the teacher picks Keep Mine (the default) or the incoming
     version. Not in the class: added, or put back with its scores if the
     teacher removed it earlier. In the class but not incoming: kept unless
     the teacher picks Remove (scores kept either way). */
  function _cmNorm(s) {
    return String(s || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  // Wording compared without its closing full stop or curly quotes.
  function _cmLoose(s) {
    return _cmNorm(s)
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[.\s]+$/, '');
  }

  function _cmSameList(a, b) {
    a = (a || []).map(_cmNorm);
    b = (b || []).map(_cmNorm);
    return (
      a.length === b.length &&
      a.every(function (x, i) {
        return x === b[i];
      })
    );
  }

  function _cmScoredAssessments(cid, tagId) {
    var seen = {};
    var scores = getScores(cid) || {};
    Object.keys(scores).forEach(function (sid) {
      (scores[sid] || []).forEach(function (s) {
        if (s && s.tagId === tagId && s.score > 0) seen[s.assessmentId] = true;
      });
    });
    return Object.keys(seen).length;
  }

  function _cmScoresNote(cid, tag) {
    var n = tag ? _cmScoredAssessments(cid, tag.id) : 0;
    return n ? 'Has scores in ' + n + (n === 1 ? ' assessment.' : ' assessments.') : 'No scores yet.';
  }

  function _cmIcanNote(n) {
    return n + (n === 1 ? ' I Can statement' : ' I Can statements');
  }

  // Pair incoming competencies with sections, one pass per key so a
  // wording match is never taken by an earlier code or title match.
  function _cmMatch(cands, secs, keys, start) {
    var pairs = start ? start.pairs : {};
    var used = start ? start.used : {};
    keys.forEach(function (key) {
      cands.forEach(function (c, ci) {
        if (pairs[ci] != null) return;
        var want = key.cand(c);
        if (!want) return;
        var si = secs.findIndex(function (s, i) {
          if (used[i]) return false;
          return key.sec(s).indexOf(want) >= 0;
        });
        if (si >= 0) {
          pairs[ci] = si;
          used[si] = true;
        }
      });
    });
    return { pairs: pairs, used: used };
  }

  var CM_MATCH_KEYS = [
    // The bank's own id: a class built from the rebuilt bank.
    {
      cand: function (c) {
        return c.bank_id || '';
      },
      sec: function (s) {
        var t = s.tags[0] || {};
        return t.bank_id ? [t.bank_id] : [];
      },
    },
    {
      cand: function (c) {
        return _cmNorm(c.source_text || c.text);
      },
      sec: function (s) {
        var t = s.tags[0] || {};
        return [_cmNorm(t.source_text), _cmNorm(t.text)].filter(Boolean);
      },
    },
    {
      cand: function (c) {
        return _cmNorm(c.code);
      },
      sec: function (s) {
        var code = _cmNorm(_cmStdCode(s.tags[0] || {}));
        return code ? [code] : [];
      },
    },
    {
      cand: function (c) {
        return _cmNorm(c.label);
      },
      sec: function (s) {
        var t = _cmNorm(_cmCompTitle(s));
        return t ? [t] : [];
      },
    },
  ];

  function _cmBuildCompReview(cid, cands, opts) {
    var secs = (getLearningMap(cid).sections || []).filter(function (s) {
      return s.tags && s.tags[0];
    });
    var removed = getRemovedSections(cid).filter(function (r) {
      return r && r.section && r.section.tags && r.section.tags[0];
    });
    // Bank ids first; then, for an older class, the crosswalk from the old
    // bank (its competencies match their old wording there, and the
    // curriculum's version is a replacement, not the teacher's edit); then
    // wording, code and title.
    var live = _cmMatch(cands, secs, CM_MATCH_KEYS.slice(0, 1));
    var crosswalk =
      opts.kind === 'curriculum' ? _cmCrosswalkPairs(cid, secs, live, cands, opts.tags || []) : { by: {}, exact: {} };
    var replacedBy = crosswalk.by;
    Object.keys(crosswalk.match).forEach(function (si) {
      live.used[si] = true;
      live.pairs[crosswalk.match[si]] = Number(si);
    });
    var takenCand = {};
    Object.keys(replacedBy).forEach(function (si) {
      live.used[si] = true;
      replacedBy[si].forEach(function (ci) {
        takenCand[ci] = true;
        live.pairs[ci] = -1;
      });
    });
    _cmMatch(cands, secs, CM_MATCH_KEYS.slice(1), live);
    var rest = [];
    cands.forEach(function (c, ci) {
      if (live.pairs[ci] == null) rest.push(ci);
    });
    var back = _cmMatch(
      rest.map(function (ci) {
        return cands[ci];
      }),
      removed.map(function (r) {
        return r.section;
      }),
      CM_MATCH_KEYS,
    );
    var review = {
      cid: cid,
      kind: opts.kind,
      fileName: opts.fileName || '',
      tags: opts.tags || [],
      add: [],
      changed: [],
      replaced: [],
      fill: [],
      onlyMine: [],
      same: [],
      showSame: false,
    };
    // A class built from the rebuilt bank left out what it doesn't have on
    // purpose, so new competencies start unticked there.
    var builtFromBank = secs.some(function (s) {
      return s.tags[0].bank_id;
    });
    cands.forEach(function (c, ci) {
      if (takenCand[ci]) return;
      var si = live.pairs[ci];
      if (si == null) {
        var ri = back.pairs[rest.indexOf(ci)];
        var removedSec = ri != null ? removed[ri].section : null;
        review.add.push({ cand: c, removed: removedSec, on: !!removedSec || !builtFromBank });
        return;
      }
      var sec = secs[si];
      var tag = sec.tags[0];
      var sameNameAndWording =
        _cmNorm(_cmCompTitle(sec)) === _cmNorm(c.label) &&
        // A competency with no wording yet differs only if the rest does.
        (!_cmNorm(tag.text) || _cmNorm(tag.text) === _cmNorm(c.text));
      // An older class's competency whose wording the Ministry kept already
      // matches, whatever name the old bank gave it.
      if (crosswalk.exact[si] && _cmLoose(tag.text) === _cmLoose(c.text)) sameNameAndWording = true;
      if (
        sameNameAndWording &&
        (crosswalk.exact[si] || _cmSameList(tag.i_can_statements, c.icans)) &&
        (tag.i_can_statements || []).length
      )
        review.same.push({ sec: sec });
      else if (sameNameAndWording && _cmSameList(tag.i_can_statements, c.icans)) review.same.push({ sec: sec });
      // No I Can statements yet, and the curriculum has some: an update.
      else if (sameNameAndWording && !(tag.i_can_statements || []).length && c.icans.length)
        review.fill.push({ sec: sec, cand: c });
      else review.changed.push({ sec: sec, cand: c, pick: 'mine' });
    });
    secs.forEach(function (sec, i) {
      if (replacedBy[i])
        // An older class's competency and the curriculum's replacement.
        review.replaced.push({
          sec: sec,
          cands: replacedBy[i].map(function (ci) {
            return cands[ci];
          }),
          pick: 'mine',
        });
      else if (!live.used[i]) review.onlyMine.push({ sec: sec, pick: 'keep' });
    });
    return review;
  }

  /* The crosswalk from the old bank (curriculum_crosswalk.json), loaded
     with the curriculum for Re-link. */
  state._cmCrosswalk = null;
  function _cmLoadCrosswalk() {
    if (window._CURRICULUM_CROSSWALK) return Promise.resolve((state._cmCrosswalk = window._CURRICULUM_CROSSWALK));
    if (state._cmCrosswalk) return Promise.resolve(state._cmCrosswalk);
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return fetch('/curriculum_crosswalk.json')
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        state._cmCrosswalk = data;
        return data;
      })
      .catch(function () {
        return null;
      });
  }

  /* For each class competency no match took, the incoming competencies the
     crosswalk says replace it: by section index, a list of candidate
     indexes in the crosswalk's order. Matched by the old wording, else by
     the old code when only one old competency and only one of the class's
     has it. An old competency whose wording the Ministry kept (an "exact"
     row) isn't a replacement: the wording match takes it, and it's listed
     in exact so the review treats it as already matching. */
  function _cmCrosswalkPairs(cid, secs, live, cands, tags) {
    var cw = window._CURRICULUM_CROSSWALK || state._cmCrosswalk;
    var out = { by: {}, exact: {}, match: {} };
    if (!cw || !cw.pairs) return out;
    var olds = ((COURSES[cid] && COURSES[cid].curriculumTags) || []).concat(tags);
    var rows = [];
    olds.forEach(function (k) {
      if (cw.pairs[k] && rows.indexOf(cw.pairs[k]) < 0) rows.push(cw.pairs[k]);
    });
    if (!rows.length) return out;
    rows = [].concat.apply([], rows);
    var freeCand = {};
    cands.forEach(function (c, ci) {
      if (live.pairs[ci] == null && c.bank_id) freeCand[c.bank_id] = ci;
    });
    function wordsOf(sec) {
      var tag = sec.tags[0];
      return [_cmNorm(tag.source_text), _cmNorm(tag.text)].filter(Boolean);
    }
    function codeOf(sec) {
      return _cmNorm(_cmStdCode(sec.tags[0]));
    }
    var byWording = secs.map(function (sec) {
      var words = wordsOf(sec);
      return (
        rows.find(function (r) {
          return words.indexOf(_cmNorm(r.raw)) >= 0;
        }) || null
      );
    });
    var codeCount = {};
    secs.forEach(function (sec) {
      var code = codeOf(sec);
      if (code) codeCount[code] = (codeCount[code] || 0) + 1;
    });
    secs.forEach(function (sec, si) {
      if (live.used[si]) return;
      var row = byWording[si];
      if (!row) {
        var code = codeOf(sec);
        var byCode = rows.filter(function (r) {
          return code && _cmNorm(r.code) === code;
        });
        if (byCode.length === 1 && codeCount[code] === 1 && byWording.indexOf(byCode[0]) < 0) row = byCode[0];
      }
      if (!row) return;
      var words = wordsOf(sec);
      var got = row.to
        .map(function (id) {
          return freeCand[id];
        })
        .filter(function (ci) {
          return ci != null;
        });
      if (!got.length) return;
      // The Ministry kept the wording: the same competency, matched here so
      // a trailing full stop can't split them.
      var same = got.find(function (ci) {
        return words.some(function (w) {
          return _cmLoose(w) === _cmLoose(cands[ci].text);
        });
      });
      if (same != null && (row.kind === 'exact' || row.to.length === 1)) {
        out.exact[si] = true;
        out.match[si] = same;
        delete freeCand[cands[same].bank_id];
        return;
      }
      got.forEach(function (ci) {
        delete freeCand[cands[ci].bank_id];
      });
      out.by[si] = got;
    });
    return out;
  }

  /* Open the review. A signed-in teacher's removed competencies come from
     the server too, so one removed on another device is offered back. */
  function _cmOpenCompReview(cid, cands, opts) {
    state.cmCompReview = _cmBuildCompReview(cid, cands, opts);
    state.cmCompReview.cands = cands;
    state.cmCompReview.opts = opts;
    renderClassManager();
    var opened = state.cmCompReview;
    if (window.v2 && typeof window.v2.listRemovedSections === 'function') {
      Promise.resolve(window.v2.listRemovedSections(cid))
        .then(function (res) {
          if (!res || !Array.isArray(res.data) || !res.data.length) return;
          var before = getRemovedSections(cid).length;
          mergeRemovedSectionsFromServer(cid, res.data);
          if (state.cmCompReview !== opened || getRemovedSections(cid).length === before) return;
          state.cmCompReview = _cmBuildCompReview(cid, cands, opts);
          state.cmCompReview.cands = cands;
          state.cmCompReview.opts = opts;
          renderClassManager();
        })
        .catch(function () {});
    }
  }

  function _cmCurriculumCands(tags) {
    var built = buildLearningMapFromTags(tags) || { subjects: [], sections: [] };
    return (built.sections || []).map(function (sec) {
      var tag = sec.tags[0] || {};
      var group = (built.competencyGroups || []).find(function (g) {
        return g.id === sec.groupId;
      });
      return {
        code: tag.code || '',
        label: tag.label || '',
        text: tag.text || '',
        source_text: tag.source_text || '',
        icans: (tag.i_can_statements || []).slice(),
        bank_id: tag.bank_id || '',
        // Its Ministry folder, by name: the class's folder of that name
        // takes it.
        folder: group ? group.name : '',
        section: sec,
        subject: (built.subjects || []).find(function (s) {
          return s.id === sec.subject;
        }),
      };
    });
  }

  function _cmIcanDiffNote(mine, theirs) {
    var t = {};
    (theirs || []).forEach(function (s) {
      t[_cmNorm(s)] = true;
    });
    var m = {};
    (mine || []).forEach(function (s) {
      m[_cmNorm(s)] = true;
    });
    var added = (mine || []).filter(function (s) {
      return !t[_cmNorm(s)];
    }).length;
    var dropped = (theirs || []).filter(function (s) {
      return !m[_cmNorm(s)];
    }).length;
    var parts = [];
    if (added) parts.push('you added ' + added);
    if (dropped) parts.push('you removed ' + dropped);
    return parts.length ? ' (' + parts.join(', ') + ')' : '';
  }

  function _cmRenderCompReview(cid) {
    var r = state.cmCompReview;
    if (!r) return '';
    var file = r.kind === 'file';
    var course = COURSES[cid];
    var linked = (r.tags || [])
      .map(function (t) {
        var c = CURRICULUM_INDEX ? CURRICULUM_INDEX[t] : null;
        return c ? c.course_name : t;
      })
      .join(', ');
    function chip(sec, code) {
      var color = (sec && sec.color) || (getLearningMap(cid).subjects || [{}])[0].color || 'var(--active)';
      return code ? '<span class="cm-std-code" style="--chip:' + color + '">' + esc(code) + '</span>' : '';
    }
    function group(title, items, body) {
      if (!items.length) return '';
      return (
        '<section class="cm-section cm-cr-group">' +
        '<div class="cm-import-group-head"><h3>' +
        title +
        '</h3><span>' +
        items.length +
        '</span></div>' +
        items.map(body).join('') +
        '</section>'
      );
    }
    var html =
      '<div class="cm-comp-review">' +
      '<button type="button" class="cm-back-link" data-action="cmCompReviewCancel">\u2039 Back to Competencies</button>' +
      '<div class="cm-cr-head">' +
      '<h1 class="cm-head-title">' +
      (file
        ? 'Import Competencies'
        : (course.curriculumTags || []).length
          ? 'Re-link Curriculum'
          : 'Link to BC Curriculum') +
      ': Review Changes</h1>' +
      '<div class="cm-cr-sub">' +
      esc(file ? r.fileName : linked) +
      '. Competencies are matched by code and curriculum wording, so nothing is added twice. Nothing changes until you press Apply.</div>' +
      '</div>';

    // An older class's competency and the curriculum's replacement for it.
    html += group('Replaced in the Curriculum', r.replaced, function (x, i) {
      var tag = x.sec.tags[0];
      var many = x.cands.length > 1;
      var note = !many ? 'Your scores stay with it.' : _cmReplacedNote(cid, x);
      function option(pick, label, inner) {
        return (
          '<label class="cm-cr-option' +
          (x.pick === pick ? ' on' : '') +
          '">' +
          '<input type="radio" name="cm-cr-replaced-' +
          i +
          '"' +
          (x.pick === pick ? ' checked' : '') +
          ' data-action-change="cmCompReviewPick" data-group="replaced" data-idx="' +
          i +
          '" data-pick="' +
          pick +
          '">' +
          '<span class="cm-cr-text"><span class="cm-cr-pick">' +
          label +
          '</span>' +
          inner +
          '</span>' +
          '</label>'
        );
      }
      return (
        '<div class="cm-cr-changed">' +
        '<div class="cm-cr-changed-head">' +
        chip(x.sec, _cmStdCode(tag)) +
        '<span class="cm-cr-note">' +
        _cmScoresNote(cid, tag) +
        (_cmScoredAssessments(cid, tag.id) ? ' Scores stay either way.' : '') +
        '</span></div>' +
        '<div class="cm-cr-options" role="radiogroup" aria-label="' +
        esc(_cmCompTitle(x.sec)) +
        '">' +
        option(
          'mine',
          'Keep Mine',
          '<span class="cm-cr-name">' +
            esc(_cmCompTitle(x.sec)) +
            '</span>' +
            (tag.text ? '<span class="cm-cr-wording">' + esc(tag.text) + '</span>' : ''),
        ) +
        option(
          'theirs',
          many ? 'Add the Curriculum Version' : 'Use the Curriculum Version',
          '<span class="cm-cr-note">' +
            esc(note) +
            '</span><span class="cm-cr-repl-list">' +
            x.cands
              .map(function (c) {
                return (
                  '<span class="cm-cr-repl-item">' +
                  chip(x.sec, c.code) +
                  '<span class="cm-cr-text"><span class="cm-cr-name">' +
                  esc(c.label || c.text) +
                  '</span><span class="cm-cr-wording">' +
                  esc(c.text) +
                  '</span></span></span>'
                );
              })
              .join('') +
            '</span>',
        ) +
        '</div>' +
        '</div>'
      );
    });

    html += group(
      file ? 'In the File, Not in Your Class' : 'In the Curriculum, Not in Your Class',
      r.add,
      function (a, i) {
        var src = a.removed || a.cand.section || {};
        var code = a.removed ? _cmStdCode(a.removed.tags[0]) : a.cand.code;
        var n = a.removed ? (a.removed.tags[0].i_can_statements || []).length : a.cand.icans.length;
        return (
          '<label class="cm-cr-row">' +
          '<input type="checkbox"' +
          (a.on ? ' checked' : '') +
          ' data-action-change="cmCompReviewToggle" data-idx="' +
          i +
          '">' +
          chip(src, code) +
          '<span class="cm-cr-text"><span class="cm-cr-name">' +
          esc(a.removed ? _cmCompTitle(a.removed) : a.cand.label || a.cand.text) +
          '</span>' +
          (a.removed
            ? '<span class="cm-cr-note">You removed this from the class earlier. ' + _cmIcanNote(n) + '.</span>'
            : a.cand.text && a.cand.text !== a.cand.label
              ? '<span class="cm-cr-wording">' + esc(a.cand.text) + '</span>'
              : '<span class="cm-cr-note">' + _cmIcanNote(n) + '.</span>') +
          '</span>' +
          '<span class="cm-cr-verb">' +
          (a.removed ? 'Add Back' : 'Add') +
          '</span>' +
          '</label>'
        );
      },
    );

    html += group('You Changed These', r.changed, function (c, i) {
      var tag = c.sec.tags[0];
      var mineIcans = tag.i_can_statements || [];
      var wording =
        _cmNorm(tag.text) === _cmNorm(c.cand.text) ? '' : tag.text ? ' \u00B7 wording edited' : ' \u00B7 no wording';
      function option(pick, label, name, note) {
        return (
          '<label class="cm-cr-option' +
          (c.pick === pick ? ' on' : '') +
          '">' +
          '<input type="radio" name="cm-cr-changed-' +
          i +
          '"' +
          (c.pick === pick ? ' checked' : '') +
          ' data-action-change="cmCompReviewPick" data-group="changed" data-idx="' +
          i +
          '" data-pick="' +
          pick +
          '">' +
          '<span class="cm-cr-text"><span class="cm-cr-pick">' +
          label +
          '</span><span class="cm-cr-name">' +
          esc(name) +
          '</span><span class="cm-cr-note">' +
          note +
          '</span></span>' +
          '</label>'
        );
      }
      return (
        '<div class="cm-cr-changed">' +
        '<div class="cm-cr-changed-head">' +
        chip(c.sec, _cmStdCode(tag)) +
        '<span class="cm-cr-note">' +
        _cmScoresNote(cid, tag) +
        (_cmScoredAssessments(cid, tag.id) ? ' Scores stay either way.' : '') +
        '</span></div>' +
        '<div class="cm-cr-options" role="radiogroup" aria-label="' +
        esc(_cmCompTitle(c.sec)) +
        '">' +
        option(
          'mine',
          'Keep Mine',
          _cmCompTitle(c.sec),
          _cmIcanNote(mineIcans.length) + _cmIcanDiffNote(mineIcans, c.cand.icans) + wording,
        ) +
        option(
          'theirs',
          file ? 'Use the File\u2019s Version' : 'Use the Curriculum Version',
          c.cand.label || c.cand.text,
          _cmIcanNote(c.cand.icans.length),
        ) +
        '</div>' +
        '</div>'
      );
    });

    html += group('Only in Your Class', r.onlyMine, function (o, i) {
      var tag = o.sec.tags[0];
      var why = file ? 'Not in the file.' : tag.source_text ? 'Not in this curriculum.' : 'One of your own.';
      function seg(pick, label) {
        return (
          '<label class="cm-cr-seg' +
          (o.pick === pick ? ' on' : '') +
          '"><input type="radio" name="cm-cr-only-' +
          i +
          '"' +
          (o.pick === pick ? ' checked' : '') +
          ' data-action-change="cmCompReviewPick" data-group="onlyMine" data-idx="' +
          i +
          '" data-pick="' +
          pick +
          '">' +
          label +
          '</label>'
        );
      }
      return (
        '<div class="cm-cr-row">' +
        chip(o.sec, _cmStdCode(tag)) +
        '<span class="cm-cr-text"><span class="cm-cr-name">' +
        esc(_cmCompTitle(o.sec)) +
        '</span><span class="cm-cr-note">' +
        why +
        ' ' +
        _cmScoresNote(cid, tag) +
        '</span></span>' +
        '<div class="cm-cr-segs" role="radiogroup" aria-label="' +
        esc(_cmCompTitle(o.sec)) +
        '">' +
        seg('keep', 'Keep') +
        seg('remove', 'Remove') +
        '</div>' +
        '</div>'
      );
    });

    if (r.same.length) {
      var codes = r.same.map(function (s) {
        return _cmStdCode(s.sec.tags[0]) || _cmCompTitle(s.sec);
      });
      html +=
        '<section class="cm-section cm-cr-same">' +
        '<div class="cm-cr-same-head"><div class="cm-cr-text"><h3>' +
        (file ? 'Already Match the File' : 'Already Match the Curriculum') +
        ' <span>' +
        r.same.length +
        '</span></h3><span class="cm-cr-note">' +
        esc(
          codes.length > 8 ? codes.slice(0, 8).join(', ') + ' and ' + (codes.length - 8) + ' more' : codes.join(', '),
        ) +
        (codes.length === 1 ? ' stays as it is.' : ' stay as they are.') +
        '</span></div>' +
        '<button type="button" class="cm-add-link" data-action="cmCompReviewShowSame" aria-expanded="' +
        r.showSame +
        '">' +
        (r.showSame ? 'Hide' : 'Show') +
        '</button></div>' +
        (r.showSame
          ? '<div class="cm-cr-same-list">' +
            r.same
              .map(function (s) {
                return (
                  '<div class="cm-cr-same-row">' +
                  chip(s.sec, _cmStdCode(s.sec.tags[0])) +
                  '<span>' +
                  esc(_cmCompTitle(s.sec)) +
                  '</span></div>'
                );
              })
              .join('') +
            '</div>'
          : '') +
        '</section>';
    }

    var s = _cmCompReviewSummary(r);
    html +=
      '<div class="cm-import-foot">' +
      '<div>' +
      s +
      '</div>' +
      '<div class="cm-import-buttons">' +
      '<button type="button" class="cm-action-btn" data-action="cmCompReviewCancel">Cancel</button>' +
      '<button type="button" class="btn btn-primary" data-action="cmCompReviewApply"' +
      (_cmCompReviewCount(r) === 0 && !_cmCompReviewLinkChanges(r) ? ' disabled' : '') +
      '>Apply Changes</button>' +
      '</div>' +
      '</div>' +
      '</div>';
    return html;
  }

  function _cmCompReviewLinkChanges(r) {
    if (r.kind === 'file') return false;
    var now = (COURSES[r.cid] && COURSES[r.cid].curriculumTags) || [];
    return now.slice().sort().join('|') !== (r.tags || []).slice().sort().join('|');
  }

  function _cmCompReviewParts(r) {
    var file = r.kind === 'file';
    return {
      back: r.add.filter(function (a) {
        return a.on && a.removed;
      }),
      add: r.add.filter(function (a) {
        return a.on && !a.removed;
      }),
      theirs: r.changed.filter(function (c) {
        return c.pick === 'theirs';
      }),
      replaced: (r.replaced || []).filter(function (x) {
        return x.pick === 'theirs';
      }),
      fill: r.fill || [],
      remove: r.onlyMine.filter(function (o) {
        return o.pick === 'remove';
      }),
      versionOf: file ? 'use the file\u2019s version of ' : 'use the curriculum version of ',
    };
  }

  function _cmCompReviewCount(r) {
    var p = _cmCompReviewParts(r);
    return p.back.length + p.add.length + p.theirs.length + p.replaced.length + p.fill.length + p.remove.length;
  }

  function _cmCompReviewSummary(r) {
    var p = _cmCompReviewParts(r);
    var n = _cmCompReviewCount(r);
    if (!n) {
      return _cmCompReviewLinkChanges(r)
        ? '<strong>No competency changes.</strong> Apply saves the new curriculum link.'
        : '<strong>No changes.</strong>';
    }
    function names(list, fn) {
      return list.map(fn);
    }
    var phrases = [];
    if (p.back.length)
      phrases.push(
        'add back ' +
          _cmJoinNames(
            names(p.back, function (a) {
              return _cmCompTitle(a.removed);
            }),
            'competencies',
          ),
      );
    if (p.add.length)
      phrases.push(
        'add ' +
          _cmJoinNames(
            names(p.add, function (a) {
              return a.cand.label || a.cand.text;
            }),
            'competencies',
          ),
      );
    if (p.theirs.length)
      phrases.push(
        p.versionOf +
          _cmJoinNames(
            names(p.theirs, function (c) {
              return _cmCompTitle(c.sec);
            }),
            'competencies',
          ),
      );
    var replacedOne = p.replaced.filter(function (x) {
      return x.cands.length === 1;
    });
    var replacedMany = p.replaced.filter(function (x) {
      return x.cands.length > 1;
    });
    if (replacedOne.length)
      phrases.push(
        'use the curriculum version of ' +
          _cmJoinNames(
            names(replacedOne, function (x) {
              return _cmCompTitle(x.sec);
            }),
            'competencies',
          ),
      );
    if (replacedMany.length)
      phrases.push(
        'add the curriculum version of ' +
          _cmJoinNames(
            names(replacedMany, function (x) {
              return _cmCompTitle(x.sec) + ' (' + x.cands.length + ' competencies)';
            }),
            'competencies',
          ),
      );
    if (p.fill.length)
      phrases.push(
        'add I Can statements to ' +
          _cmJoinNames(
            names(p.fill, function (x) {
              return _cmCompTitle(x.sec);
            }),
            'competencies',
          ),
      );
    if (p.remove.length)
      phrases.push(
        'remove ' +
          _cmJoinNames(
            names(p.remove, function (o) {
              return _cmCompTitle(o.sec);
            }),
            'competencies',
          ),
      );
    var tail =
      p.theirs.length || p.replaced.length || p.remove.length
        ? ' Scores are kept.'
        : r.onlyMine.length
          ? ' Your edits and your own competencies stay.'
          : ' Your edits stay.';
    // Removing one moves grades, as the Remove confirm says.
    if (p.remove.length) {
      var moved = previewCompetencyRemoval(
        r.cid,
        p.remove.map(function (o) {
          return _currentId('section', o.sec.id);
        }),
      );
      if (moved.changed)
        tail += ' The removals change the grade for ' + moved.changed + ' of your ' + moved.total + ' students.';
    }
    return '<strong>' + n + (n === 1 ? ' change:' : ' changes:') + '</strong> ' + esc(phrases.join('; ')) + '.' + tail;
  }

  function cmCompReviewToggle(idx, on) {
    if (!state.cmCompReview || !state.cmCompReview.add[idx]) return;
    state.cmCompReview.add[idx].on = !!on;
    _cmRenderAndFocus('[data-action-change="cmCompReviewToggle"][data-idx=' + _cmAttr(idx) + ']');
  }

  function cmCompReviewPick(group, idx, pick) {
    var list = state.cmCompReview && state.cmCompReview[group];
    if (!list || !list[idx]) return;
    list[idx].pick = pick;
    _cmRenderAndFocus(
      '[data-action-change="cmCompReviewPick"][data-group=' +
        _cmAttr(group) +
        '][data-idx=' +
        _cmAttr(idx) +
        '][data-pick=' +
        _cmAttr(pick) +
        ']',
    );
  }

  function cmCompReviewShowSame() {
    if (!state.cmCompReview) return;
    state.cmCompReview.showSame = !state.cmCompReview.showSame;
    _cmRenderAndFocus('[data-action="cmCompReviewShowSame"]');
  }

  function _cmCloseCompReview() {
    state.cmCompReview = null;
    state.cmRelinkCid = null;
    state.cmRelinkStep = 0;
    state.cwSelectedTags = [];
  }

  function cmCompReviewCancel() {
    _cmCloseCompReview();
    state.cmTab = 'competencies';
    renderClassManager();
  }

  /* Apply the review. Changes to the learning map that would move any
     student's overall proficiency ask first, with the count, as the
     grading settings do. */
  function cmCompReviewApply(confirmed) {
    var r = state.cmCompReview;
    if (!r) return;
    var cid = r.cid;
    var p = _cmCompReviewParts(r);
    var touchesMap = p.add.length || p.theirs.length || p.replaced.length || p.fill.length;
    var removeIds = p.remove.map(function (o) {
      return _currentId('section', o.sec.id);
    });

    if ((touchesMap || p.back.length || p.remove.length) && confirmed !== true) {
      // The copy gets the whole Apply, in its order: put back, map edits, removals.
      var preview = previewLearningMapChange(cid, function (copy) {
        if (!copy.sections) copy.sections = [];
        p.back.forEach(function (a) {
          var id = a.removed.id;
          if (
            !copy.sections.some(function (s) {
              return s.id === id;
            })
          )
            copy.sections.push(structuredClone(a.removed));
        });
        if (touchesMap) _cmApplyReviewToMap(cid, copy, p);
        var drop = {};
        removeIds.forEach(function (id) {
          drop[resolveLearningMapId(cid, 'section', id)] = true;
        });
        copy.sections = copy.sections.filter(function (s) {
          return !drop[s.id];
        });
      });
      if (preview.changed) {
        showConfirm(
          'Change Grades?',
          _cmGradeChangeMessage(cid, preview) + CM_FOLDER_COUNT_SENT,
          'Apply Changes',
          'primary',
          function () {
            cmCompReviewApply(true);
          },
        );
        return;
      }
    }

    // Put removed competencies back first: each brings its scores with it.
    p.back.forEach(function (a) {
      restoreCompetency(cid, a.removed.id);
    });

    if (touchesMap) {
      var map = ensureCustomLearningMap(cid);
      _cmApplyReviewToMap(cid, map, p);
      saveLearningMap(cid, map);
    }

    if (p.remove.length) removeCompetencies(cid, removeIds);

    if (r.kind !== 'file' && _cmCompReviewLinkChanges(r)) updateCourse(cid, { curriculumTags: r.tags.slice() });

    _cmCloseCompReview();
    state.cmTab = 'competencies';
    renderClassManager();
  }

  /* The review's changes to a learning map: Replaced in the Curriculum
     first (it makes the Ministry folders), then the additions, the I Can
     fills and the curriculum versions. */
  function _cmApplyReviewToMap(cid, map, p) {
    if (!map.subjects) map.subjects = [];
    if (!map.sections) map.sections = [];
    if (!map.competencyGroups) map.competencyGroups = [];
    var taken = {};
    map.sections.forEach(function (s) {
      taken[s.id] = true;
    });
    getRemovedSections(cid).forEach(function (x) {
      if (x && x.section) taken[x.section.id] = true;
    });
    function freshId(base) {
      var id = base && !taken[base] ? base : (base ? base + '_' : '') + uid();
      taken[id] = true;
      return id;
    }
    function findSec(id) {
      return map.sections.find(function (s) {
        return s.id === _currentId('section', id);
      });
    }
    // The class's folder with a Ministry folder's name, made if missing.
    function folderFor(name, color) {
      if (!name) return null;
      var grp = _cmFolderNamed(map, name);
      if (!grp) {
        grp = {
          id: 'grp_' + uid(),
          name: name,
          color: color || '#6366f1',
          sortOrder: map.competencyGroups.length,
        };
        map.competencyGroups.push(grp);
      }
      return grp;
    }
    // A curriculum competency as a new row of this class.
    function addFromCurriculum(c, grp) {
      var add = structuredClone(c.section);
      add.id = freshId('');
      add.tags[0].id = add.id;
      var subjectId = _cmClassSubjectFor(map, c.subject);
      if (subjectId) add.subject = add.tags[0].subject = subjectId;
      delete add.groupId;
      if (grp) add.groupId = grp.id;
      map.sections.push(add);
    }

    // Replaced in the Curriculum. One for one: the competency takes the
    // curriculum's name, code, wording and course in place, keeping its
    // scores. One for several: each statement goes in its own Ministry
    // folder, and the competency moves, unchanged, into the folder most of
    // them go to.
    p.replaced.forEach(function (x) {
      var sec = findSec(x.sec.id);
      if (!sec || !sec.tags[0]) return;
      var tag = sec.tags[0];
      var lead = x.cands[0];
      var subjectId = _cmClassSubjectFor(map, lead.subject);
      if (subjectId && sec.subject !== subjectId) {
        sec.subject = tag.subject = subjectId;
        sec.color = tag.color = lead.section.color;
      }
      if (x.cands.length === 1) {
        tag.label = lead.label;
        tag.code = lead.code;
        tag.text = lead.text;
        tag.source_text = lead.source_text;
        tag.i_can_statements = lead.icans.slice();
        tag.bank_id = lead.bank_id || null;
        sec.name = tag.name = lead.label;
        sec.shortName = tag.shortName = lead.section.shortName;
        return;
      }
      var home = _cmReplacedHome(x);
      if (home) sec.groupId = folderFor(home, sec.color).id;
      x.cands.forEach(function (c) {
        addFromCurriculum(c, folderFor(c.folder, c.section.color));
      });
    });

    p.add.forEach(function (a) {
      var c = a.cand;
      if (c.section) {
        // From the curriculum: the class's folder with its Ministry
        // folder's name takes it.
        addFromCurriculum(c, c.folder ? _cmFolderNamed(map, c.folder) : null);
        return;
      }
      if (!map.subjects.length) map.subjects.push({ id: 'subj1', name: 'General', color: '#6366f1' });
      var sub = map.subjects[0];
      var id = freshId('');
      var label = c.label || c.text.slice(0, 40);
      var short = label.split(' ')[0];
      var sec = {
        id: id,
        subject: sub.id,
        name: label,
        shortName: short,
        color: sub.color,
        tags: [
          {
            id: id,
            code: c.code || undefined,
            label: label,
            text: c.text,
            i_can_statements: c.icans.slice(),
            color: sub.color,
            subject: sub.id,
            name: label,
            shortName: short,
          },
        ],
      };
      if (!sec.tags[0].code) delete sec.tags[0].code;
      if (c.folder) sec.groupId = folderFor(c.folder, '#6366f1').id;
      map.sections.push(sec);
    });

    // No I Can statements yet: the curriculum's.
    p.fill.forEach(function (x) {
      var sec = findSec(x.sec.id);
      if (sec && sec.tags[0] && !(sec.tags[0].i_can_statements || []).length)
        sec.tags[0].i_can_statements = x.cand.icans.slice();
    });

    p.theirs.forEach(function (ch) {
      var sec = findSec(ch.sec.id);
      if (!sec || !sec.tags[0]) return;
      var tag = sec.tags[0];
      if (ch.cand.label) tag.label = ch.cand.label;
      tag.text = ch.cand.text;
      tag.i_can_statements = ch.cand.icans.slice();
      if (ch.cand.source_text) tag.source_text = ch.cand.source_text;
    });
    map._flatVersion = 2;
  }

  /* The class's course for a curriculum candidate's: the one with its id
     or its name, else a new one with a fresh id. */
  function _cmClassSubjectFor(map, subject) {
    if (!subject) return null;
    var own = (map.subjects || []).find(function (s) {
      return s.id === subject.id || _cmNorm(s.name) === _cmNorm(subject.name);
    });
    if (own) return own.id;
    var add = structuredClone(subject);
    add.id = uid();
    map.subjects.push(add);
    return add.id;
  }

  /* Where Add the Curriculum Version puts things, in words: each Ministry
     folder the statements go to, and where the old competency goes. */
  function _cmReplacedNote(cid, x) {
    var map = getLearningMap(cid);
    var folders = [];
    x.cands.forEach(function (c) {
      if (c.folder && folders.indexOf(c.folder) < 0) folders.push(c.folder);
    });
    var where = folders.map(function (name) {
      return _cmFolderNamed(map, name) ? 'your ' + name + ' folder' : 'a new folder, ' + name;
    });
    var home = _cmReplacedHome(x);
    return (
      'Adds these ' +
      x.cands.length +
      (where.length ? ' in ' + where.join(' and ') : '') +
      '. Your ' +
      (_cmStdCode(x.sec.tags[0]) || _cmCompTitle(x.sec)) +
      (home
        ? (where.length === 1 ? ' moves into the same folder' : ' moves into the ' + home + ' folder') +
          ' and keeps its scores.'
        : ' keeps its scores.') +
      ' Nothing is renamed.'
    );
  }

  // The Ministry folder most of a merged line's statements go to.
  function _cmReplacedHome(x) {
    var count = {};
    var best = '';
    x.cands.forEach(function (c) {
      if (!c.folder) return;
      count[c.folder] = (count[c.folder] || 0) + 1;
      if (!best || count[c.folder] > count[best]) best = c.folder;
    });
    return best;
  }

  function _cmFolderNamed(map, name) {
    return (map.competencyGroups || []).find(function (g) {
      return _cmNorm(g.name) === _cmNorm(name);
    });
  }

  /* The Remove confirm: what it does to grades, then that the scores are
     kept for putting it back. */
  function _cmRemoveMessage(cid, secIds, lead) {
    var preview = previewCompetencyRemoval(cid, secIds);
    var moves = preview.changed
      ? ' This changes the grade for ' +
        preview.changed +
        ' of your ' +
        preview.total +
        ' students' +
        (preview.example
          ? '. For example, ' +
            preview.example.name +
            ' goes from ' +
            preview.example.before +
            ' to ' +
            preview.example.after +
            '.'
          : '.') +
        ' Marks you\u2019ve already copied into MyEd won\u2019t change there.'
      : '';
    return (
      lead +
      moves +
      (secIds.length === 1
        ? ' Its scores are kept, so Re-link can put it back.'
        : ' Their scores are kept, so Re-link can put them back.')
    );
  }

  function cmDeleteStd(secId) {
    var current = _currentId('section', secId);
    showConfirm(
      'Remove Competency',
      _cmRemoveMessage(state.cmSelectedCourse, [current], 'Remove this competency from the class?'),
      'Remove',
      'danger',
      function () {
        // Resolved now: the id may have been re-keyed while the dialog was open.
        removeCompetencies(state.cmSelectedCourse, [_currentId('section', secId)]);
        renderClassManager();
      },
    );
  }

  function cmUpdateStdLabel(secId, val) {
    secId = _currentId('section', secId);
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var sec = map.sections.find(function (s) {
      return s.id === secId;
    });
    if (sec && sec.tags[0]) {
      sec.tags[0].label = val.trim();
      saveLearningMap(cid, map);
    }
  }

  /* Typing a title renames the card header as you go; blur saves it. */
  function cmStdLabelLive(secId, val) {
    var card = document.getElementById('cm-std-' + secId);
    if (!card) return;
    var label = card.querySelector('.cm-std-label');
    if (!label) return;
    var title = val.trim() || label.dataset.fallback || '';
    label.textContent = title;
    var menuBtn = card.querySelector('.cm-std-icon-btn');
    if (menuBtn) menuBtn.setAttribute('aria-label', 'More actions for ' + title);
  }

  function cmUpdateStdText(secId, val) {
    secId = _currentId('section', secId);
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var sec = map.sections.find(function (s) {
      return s.id === secId;
    });
    if (sec && sec.tags[0]) {
      sec.tags[0].text = val.trim();
      saveLearningMap(cid, map);
    }
  }

  /* The card's own competency, from a fresh copy of the map. */
  function _cmStdEntry(secId) {
    if (!state.cmSelectedCourse) return null;
    secId = _currentId('section', secId);
    var map = ensureCustomLearningMap(state.cmSelectedCourse);
    var sec = (map.sections || []).find(function (s) {
      return s.id === secId;
    });
    if (!sec || !sec.tags || !sec.tags[0]) return null;
    return { map: map, sec: sec, tag: sec.tags[0] };
  }

  function _cmStdSave(entry, focusSel) {
    saveLearningMap(state.cmSelectedCourse, entry.map);
    renderClassManager();
    if (!focusSel) return;
    requestAnimationFrame(function () {
      var el = document.querySelector('#cm-std-' + entry.sec.id + ' ' + focusSel);
      if (el) el.focus();
    });
  }

  /* The card's Levels (Nov 2 mockup, batch 2): each level's descriptor and
     next step, read-only, by the printed rubric's rule (CompetencyWording:
     the teacher's own, else the bank's, else the BC general wording). Write
     Your Own opens the four levels for the teacher's own wording, saved to
     the descriptor bank printed rubrics read; a level left empty keeps the
     other wording. */
  function _cmLevelsHtml(sec, tag) {
    if (!tag || !tag.id || !window.CompetencyWording || !window.RubricPrint) return '';
    var levels = [1, 2, 3, 4];
    var lines = levels.map(function (l) {
      var x = CompetencyWording.lines(tag, l);
      // The BC general wording reads in full here, "The student
      // demonstrates …", as the printed Tag Rubric has it.
      var raw = CompetencyWording.levelWording(tag, l).text;
      if (x && raw === CompetencyWording.GENERAL[l]) x.descriptor = raw;
      return x;
    });
    if (lines[0] && !lines[0].ready && !state._cmLevelsBankAsked && RubricPrint.loadBankLevels) {
      state._cmLevelsBankAsked = true;
      // Only the Competencies tab shows the Levels: on another tab the
      // next draw picks them up, so opening Class Settings draws it once.
      RubricPrint.loadBankLevels().then(function (ok) {
        if (ok && state.classManagerOpen && state.cmMode === 'edit' && state.cmTab === 'competencies')
          renderClassManager();
      });
    }
    // The open form: { drafts: { level: text }, base: { level: text the field was filled with } }.
    var editing = _cmLevelsEdit[sec.id] || null;
    var own = (typeof RubricDraft !== 'undefined' && getCompetencyDescriptor(RubricDraft.competencyKey(tag))) || {};
    var head =
      '<div class="cm-std-section-head"><span class="cm-label cm-std-section-label" id="cm-std-levels-label-' +
      sec.id +
      '">Levels</span>' +
      (editing
        ? ''
        : '<button type="button" class="cm-std-link" data-action="cmLevelsEdit" data-secid="' +
          sec.id +
          '">Write Your Own</button>') +
      '</div>';
    var body = editing
      ? '<div class="cm-levels-edit">' +
        levels
          .map(function (l, i) {
            if (!(l in editing.base)) editing.base[l] = own[l] || lines[i].descriptor;
            var val = l in editing.drafts ? editing.drafts[l] : editing.base[l];
            return (
              '<label class="cm-levels-edit-row"><span class="cm-levels-word">' +
              esc(lines[i].word) +
              '</span><textarea class="cm-textarea cm-levels-input" rows="2" data-level="' +
              l +
              '" data-secid="' +
              sec.id +
              '" data-stop-prop="true" data-action-input="cmLevelsDraft">' +
              esc(val) +
              '</textarea></label>'
            );
          })
          .join('') +
        '<p class="cm-levels-hint">Leave a level empty to use the curriculum wording.</p>' +
        '<div class="cm-levels-actions"><button type="button" class="btn btn-ghost" data-action="cmLevelsCancel" data-secid="' +
        sec.id +
        '">Cancel</button><button type="button" class="btn btn-primary" data-action="cmLevelsSave" data-secid="' +
        sec.id +
        '">Save</button></div></div>'
      : '<div class="cm-levels-list">' +
        lines
          .map(function (x) {
            return (
              '<div class="cm-level-row"><span class="cm-levels-word">' +
              esc(x.word) +
              '</span><span class="cm-level-desc">' +
              esc(x.descriptor) +
              (x.next ? '<span class="cm-level-next">Next step: ' + esc(x.next) + '</span>' : '') +
              '</span></div>'
            );
          })
          .join('') +
        '</div>';
    return '<div class="cm-std-levels" aria-labelledby="cm-std-levels-label-' + sec.id + '">' + head + body + '</div>';
  }

  function cmLevelsEdit(secId) {
    var entry = _cmStdEntry(secId);
    if (!entry) return;
    _cmLevelsEdit[entry.sec.id] = { drafts: {}, base: {} };
    renderClassManager();
    requestAnimationFrame(function () {
      var el = document.querySelector('#cm-std-' + entry.sec.id + ' .cm-levels-input');
      if (el) el.focus();
    });
  }
  function cmLevelsCancel(secId) {
    delete _cmLevelsEdit[_currentId('section', secId)];
    delete _cmLevelsEdit[secId];
    renderClassManager();
  }
  // What the teacher types is kept as they type, so a redraw of the card
  // (another field's save) keeps it.
  function cmLevelsDraft(secId, level, val) {
    var form = _cmLevelsEdit[secId] || _cmLevelsEdit[_currentId('section', secId)];
    if (form) form.drafts[level] = val;
  }
  /* Saves each level the teacher changed: its text as their own, or, emptied,
     back to the curriculum wording. A level left as it was filled is not
     saved, so wording shown before the bank loaded never becomes their own. */
  function cmLevelsSave(secId) {
    var entry = _cmStdEntry(secId);
    var form = entry && _cmLevelsEdit[entry.sec.id];
    if (!form || typeof RubricDraft === 'undefined') return;
    var key = RubricDraft.competencyKey(entry.tag);
    var entries = [];
    Object.keys(form.drafts).forEach(function (l) {
      var level = Number(l);
      var text = String(form.drafts[l] || '').trim();
      if (text === String(form.base[l] || '').trim()) return;
      var base = RubricPrint.levelWording(entry.tag, level, true).text;
      var baseLine = window.CompetencyWording ? CompetencyWording.sentence(base) : base;
      if (text === baseLine || text === base) text = '';
      entries.push({ key: key, level: level, text: text });
    });
    if (key) saveCompetencyDescriptors(entries);
    delete _cmLevelsEdit[entry.sec.id];
    renderClassManager();
  }

  function cmStdEditWording(secId) {
    var entry = _cmStdEntry(secId);
    if (!entry) return;
    _cmWordingEdit[entry.sec.id] = true;
    renderClassManager();
    requestAnimationFrame(function () {
      var el = document.querySelector('#cm-std-' + entry.sec.id + ' .cm-std-wording-input');
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }

  function cmStdFinishWording(secId, val) {
    cmUpdateStdText(secId, val);
    delete _cmWordingEdit[_currentId('section', secId)];
    delete _cmWordingEdit[secId];
    renderClassManager();
  }

  function cmStdRestoreWording(secId) {
    var entry = _cmStdEntry(secId);
    if (!entry || !entry.tag.source_text) return;
    entry.tag.text = entry.tag.source_text;
    delete _cmWordingEdit[entry.sec.id];
    _cmStdSave(entry);
  }

  function cmStdToggleMenu(btn) {
    var menu = btn.parentElement.querySelector('.cm-std-menu');
    if (!menu) return;
    var open = menu.hidden;
    _cmCloseStdMenus();
    if (open) {
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      _cmFloatOverScroll(menu, btn);
      var first =
        menu.querySelector('.cm-std-menu-item[aria-checked="true"]') || menu.querySelector('.cm-std-menu-item');
      if (first) first.focus();
    }
  }

  function _cmCloseStdMenus() {
    var any = false;
    document.querySelectorAll('.cm-std-menu:not([hidden])').forEach(function (m) {
      m.hidden = true;
      var btn = m.parentElement.querySelector('[aria-haspopup="menu"]');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      any = true;
    });
    return any;
  }

  function cmIcanAdd(secId, val) {
    var text = String(val || '').trim();
    if (!text) return;
    var entry = _cmStdEntry(secId);
    if (!entry) return;
    entry.tag.i_can_statements = (entry.tag.i_can_statements || []).concat([text]);
    _cmStdSave(entry, '.cm-ican-new');
  }

  function cmIcanEdit(secId, idx, val) {
    var entry = _cmStdEntry(secId);
    if (!entry) return;
    var list = (entry.tag.i_can_statements || []).slice();
    if (idx < 0 || idx >= list.length) return;
    var text = String(val || '').trim();
    if (text === list[idx]) return;
    if (text) list[idx] = text;
    else list.splice(idx, 1);
    entry.tag.i_can_statements = list;
    _cmStdSave(entry);
  }

  function cmIcanDelete(secId, idx) {
    var entry = _cmStdEntry(secId);
    if (!entry) return;
    var list = (entry.tag.i_can_statements || []).slice();
    if (idx < 0 || idx >= list.length) return;
    list.splice(idx, 1);
    entry.tag.i_can_statements = list;
    _cmStdSave(entry);
  }

  function cmIcanMove(secId, from, to) {
    var entry = _cmStdEntry(secId);
    if (!entry) return;
    var list = (entry.tag.i_can_statements || []).slice();
    if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return;
    var moved = list.splice(from, 1)[0];
    list.splice(to, 0, moved);
    entry.tag.i_can_statements = list;
    _cmStdSave(entry);
  }

  // A competency's code (e.g. "RD1", "ENG10A") is its own column, apart from
  // its id; saveLearningMap sends the changed tag.
  function _cmCleanCode(val) {
    return val
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9._\-]/g, '')
      .slice(0, 6);
  }

  /* Typing a code updates the header chip as you go; blur saves it. A blank
     box shows the saved code, since saving ignores a blank code. */
  function cmStdCodeLive(secId, val) {
    var card = document.getElementById('cm-std-' + secId);
    var chip = card && card.querySelector('.cm-std-code');
    if (!chip) return;
    var code = _cmCleanCode(val) || chip.dataset.fallback || '';
    chip.textContent = code;
    chip.hidden = !code;
  }

  function cmUpdateStdCode(secId, val) {
    secId = _currentId('section', secId);
    if (!state.cmSelectedCourse) return;
    var newCode = _cmCleanCode(val);
    if (!newCode) return;
    var map = ensureCustomLearningMap(state.cmSelectedCourse);
    var sec = map.sections.find(function (s) {
      return s.id === secId;
    });
    if (!sec || !sec.tags || !sec.tags[0]) return;
    var tag = sec.tags[0];
    if (newCode === tag.code) return;
    tag.code = newCode;
    saveLearningMap(state.cmSelectedCourse, map);
    renderClassManager();
  }

  function cmAddTag(secId) {
    /* no-op in flat mode */
  }
  function cmUpdateTagLabel(secId, tagId, val) {
    cmUpdateStdLabel(secId, val);
  }
  function cmUpdateTagText(secId, tagId, val) {
    cmUpdateStdText(secId, val);
  }
  function cmDeleteTag(secId, tagId) {
    cmDeleteStd(secId);
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
        document.getElementById('cm-cg-decay').style.display =
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

  /* A switch, checkbox, radio or menu changed with the keyboard keeps the
     focus: most changes redraw Class Settings, which made the control a
     new element and dropped the focus to the page. Until the next click or
     change, a redraw that leaves the focus nowhere gives it back to the same
     control (by id, else by its data attributes), including the redraws
     around a "Change Grades?" question and its answer. */
  state._cmKeepFocusSel = null;

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
      if (again) again.focus();
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
      _initCmPtsDrag();
      CmGradingBars.initDrag(_addDocListener);
    },
    destroy: _removeAllListeners,
    resetState: function () {
      state.classManagerOpen = false;
      state.cmMode = 'edit';
      state.cmTab = 'details';
      state.cmSelectedCourse = state._activeCourse;
      state._activeCourseChanged = false;
      state._cmPtsPick = null;
      state._cmPtsError = null;
      state._cmPtsTyped = null;
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
