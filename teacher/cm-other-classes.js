// @ts-check
/* cm-other-classes.js — Class Settings: other classes' data. Moved from teacher/dash-class-manager.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. DashClassManager hands
   over what this file uses through configure(). It loads before dash-class-manager.js. */
/** @type {any} */ (window).CmOtherClasses = (function () {
  'use strict';

  /* Handed over by DashClassManager (configure). */
  var _cmFloatOverScroll,
    _cmImportDoneHtml,
    _cmImportErrorHtml,
    _cmLoadGuardians,
    _cmRenderImportReview,
    _cmRenderReportingTermsField,
    _cmRosterHtml,
    _cmRosterSummary,
    _cmTermSchool,
    cmImportEmptyHtml,
    cmImportFormatHtml,
    state,
    _cmCatPrepare,
    _cmCatState,
    _cmRenderCompReview,
    _cmRenderCompToolbar,
    _cmRenderFoldersCountAsOne,
    _cmRenderGradingTab,
    _cmRenderStdCard,
    _cmRestoreKeptFocus,
    cmStartCreate,
    renderCmCreateForm,
    renderCmRelinkPanel,
    renderWithdrawnList;
  function configure(h) {
    if ('_cmFloatOverScroll' in h) _cmFloatOverScroll = h._cmFloatOverScroll;
    if ('_cmImportDoneHtml' in h) _cmImportDoneHtml = h._cmImportDoneHtml;
    if ('_cmImportErrorHtml' in h) _cmImportErrorHtml = h._cmImportErrorHtml;
    if ('_cmLoadGuardians' in h) _cmLoadGuardians = h._cmLoadGuardians;
    if ('_cmRenderImportReview' in h) _cmRenderImportReview = h._cmRenderImportReview;
    if ('_cmRenderReportingTermsField' in h) _cmRenderReportingTermsField = h._cmRenderReportingTermsField;
    if ('_cmRosterHtml' in h) _cmRosterHtml = h._cmRosterHtml;
    if ('_cmRosterSummary' in h) _cmRosterSummary = h._cmRosterSummary;
    if ('_cmTermSchool' in h) _cmTermSchool = h._cmTermSchool;
    if ('cmImportEmptyHtml' in h) cmImportEmptyHtml = h.cmImportEmptyHtml;
    if ('cmImportFormatHtml' in h) cmImportFormatHtml = h.cmImportFormatHtml;
    if ('state' in h) state = h.state;
    if ('_cmCatPrepare' in h) _cmCatPrepare = h._cmCatPrepare;
    if ('_cmCatState' in h) _cmCatState = h._cmCatState;
    if ('_cmRenderCompReview' in h) _cmRenderCompReview = h._cmRenderCompReview;
    if ('_cmRenderCompToolbar' in h) _cmRenderCompToolbar = h._cmRenderCompToolbar;
    if ('_cmRenderFoldersCountAsOne' in h) _cmRenderFoldersCountAsOne = h._cmRenderFoldersCountAsOne;
    if ('_cmRenderGradingTab' in h) _cmRenderGradingTab = h._cmRenderGradingTab;
    if ('_cmRenderStdCard' in h) _cmRenderStdCard = h._cmRenderStdCard;
    if ('_cmRestoreKeptFocus' in h) _cmRestoreKeptFocus = h._cmRestoreKeptFocus;
    if ('cmStartCreate' in h) cmStartCreate = h.cmStartCreate;
    if ('renderCmCreateForm' in h) renderCmCreateForm = h.renderCmCreateForm;
    if ('renderCmRelinkPanel' in h) renderCmRelinkPanel = h.renderCmRelinkPanel;
    if ('renderWithdrawnList' in h) renderWithdrawnList = h.renderWithdrawnList;
  }

  /* ── Other classes' data ─────────────────────────────────────
     The data layer loads every class at sign-in (preloadClasses). A class
     picked here before its turn is loaded first; until its data is in, it
     shows "Loading", so nothing is edited against an empty copy. The
     sidebar's counts fill in as each class arrives. */
  function _cmClassReady(cid) {
    return !cid || cid === state._activeCourse || typeof isClassLoaded !== 'function' || isClassLoaded(cid);
  }

  // The sidebar alone, so a background load never redraws a field the
  // teacher is typing in.
  function _cmRefreshSidebar() {
    var el = document.querySelector('.cm-sidebar');
    var mount = el ? el.parentElement : null;
    if (mount && state.classManagerOpen) CmKeepDraw.draw(mount, renderCmSidebar(Object.keys(COURSES)));
  }

  function _cmAfterLoad(cid) {
    if (!state.classManagerOpen) return;
    if (cid === state.cmSelectedCourse && state.cmMode === 'edit') renderClassManager();
    else _cmRefreshSidebar();
  }

  /* A class picked or opened here was opened, archived or not (photos stay
     until a class goes a year unopened: noteClassOpenedSoon, once a day per
     device). Never the classes loading in the background (_cmFollowLoads).
     A load under way is waited for, so it never waits on the stamp; nothing
     is loaded for it. */
  function _cmNoteOpened(cid) {
    if (!cid || typeof noteClassOpenedSoon !== 'function') return;
    var loading = typeof _classLoads !== 'undefined' && _classLoads[cid] !== true ? _classLoads[cid] : null;
    Promise.resolve(loading).then(function () {
      noteClassOpenedSoon(cid, true);
    });
  }

  // Load the picked class, then show it if it is still the one picked.
  function _cmShowWhenLoaded(cid) {
    if (_cmClassReady(cid)) return;
    loadClass(cid).then(function () {
      _cmAfterLoad(cid);
    });
  }

  // Follow the classes still loading, in the order the data layer loads
  // them, and fill each in as it lands.
  function _cmFollowLoads() {
    if (typeof classesToPreload !== 'function') return;
    preloadClasses();
    classesToPreload().reduce(function (chain, cid) {
      return chain.then(function () {
        if (!state.classManagerOpen) return;
        return loadClass(cid).then(function () {
          _cmAfterLoad(cid);
        });
      });
    }, Promise.resolve());
  }

  /* `tab` opens the manager on that tab (a link from another page). */
  // tab: a Class Settings tab, or 'new' for the New Class wizard. cid: a
  // class to show other than the open one (from the address's &class=).
  function openClassManager(tab, cid) {
    state.classManagerOpen = true;
    state.cmSelectedCourse = cid && COURSES[cid] ? cid : state._activeCourse;
    state.cmMode = 'edit';
    if (_cmTabShown(tab, state.cmSelectedCourse)) state.cmTab = tab;
    if (tab === 'new') {
      cmStartCreate();
      return;
    }
    renderClassManager();
    _cmNoteOpened(state.cmSelectedCourse);
    _cmFollowLoads();
  }

  /* Class Settings' own address, kept in step as it changes, so a reload
     or Back returns to the same tab and class (or the New Class wizard):
     /dashboard?manage=grading&class=… . The dashboard opens it from there. */
  function _cmSyncUrl() {
    if (!state.classManagerOpen || typeof Router === 'undefined' || !Router.setUrl) return;
    if (location.pathname !== '/dashboard') return;
    var url = '/dashboard?manage=' + (state.cmMode === 'create' ? 'new' : state.cmTab);
    if (
      state.cmMode !== 'create' &&
      state.cmSelectedCourse &&
      state.cmSelectedCourse !== state._activeCourse &&
      COURSES[state.cmSelectedCourse]
    )
      url += '&class=' + encodeURIComponent(state.cmSelectedCourse);
    Router.setUrl(url);
    document.title = 'FullVision \u2014 Class Settings';
  }

  function closeClassManager() {
    state.classManagerOpen = false;
    // A student's panel on the Student Page tab closes with Class Settings.
    if (typeof StudentPageStudents !== 'undefined') StudentPageStudents.closeAll();
    // The Done panel and its New marks last until Class Settings closes.
    state.cmImportDone = null;
    state.cmRosterOnly = null;
    closeColorPop();
    if (typeof Router !== 'undefined' && Router.setUrl && location.pathname === '/dashboard') {
      Router.setUrl('/dashboard');
      document.title = 'FullVision \u2014 Dashboard';
    }
    // Hand a course switch made in here back to the parent, so it re-syncs its
    // own activeCourse, loads that course's data and renders it. Without this
    // the parent falls back to whichever class was active before the manager
    // opened — and re-injects that stale id on the next configure().
    if (state._activeCourseChanged && state._onCourseChange) {
      state._activeCourseChanged = false;
      (0, state._onCourseChange)(state._activeCourse);
      return;
    }
    if (state._onRender) (0, state._onRender)();
  }

  /* ── Block picker and the empty state: teacher/cm-block-picker.js ── */
  var blockPickerHtml = CmBlockPicker.blockPickerHtml;
  var readBlockPicker = CmBlockPicker.readBlockPicker;
  var blockChipSelect = CmBlockPicker.blockChipSelect;
  var blockOtherInput = CmBlockPicker.blockOtherInput;
  var _cmEmptyStateHtml = CmBlockPicker._cmEmptyStateHtml;
  var _cwCourseRow = CmBlockPicker.wizardCourseRow;
  var _cwSeg = CmBlockPicker.wizardSeg;
  var _cwSetRow = CmBlockPicker.wizardSetRow;
  var cmOpenDemoMode = CmBlockPicker.cmOpenDemoMode;

  // A class for dashboard.css on el (the body, or #main).
  function _cmMark(el, name, on) {
    if (el && el.classList) el.classList.toggle(name, on);
  }

  /* What the detail pane shows: the New Class form, Re-link, a file's
     incoming competencies, a class still loading, or a class's tabs. */
  function _cmDetailHtml() {
    if (state.cmMode === 'create') {
      return renderCmCreateForm();
    } else if (state.cmRelinkStep > 0 && state.cmRelinkCid && COURSES[state.cmRelinkCid]) {
      return renderCmRelinkPanel(state.cmRelinkCid);
    } else if (state.cmCompReview && state.cmCompReview.kind === 'file' && COURSES[state.cmCompReview.cid]) {
      return _cmRenderCompReview(state.cmCompReview.cid);
    } else if (state.cmSelectedCourse && COURSES[state.cmSelectedCourse] && !_cmClassReady(state.cmSelectedCourse)) {
      return (
        '<div class="cm-detail-inner cm-tabbed"><div class="cm-head"><div class="cm-head-text">' +
        '<h1 class="cm-head-title">' +
        esc(COURSES[state.cmSelectedCourse].name) +
        '</h1><div class="cm-head-meta" role="status">Loading this class\u2026</div></div></div></div>'
      );
    } else if (state.cmSelectedCourse && COURSES[state.cmSelectedCourse]) {
      return renderCmDetail(state.cmSelectedCourse);
    }
    return '';
  }

  function renderClassManager() {
    var courseIds = Object.keys(COURSES);
    // Class Settings reads the year so far for every class: its previews
    // (calculation method, Folders Count as One) and Check With a Student
    // never count as of a report left in view on the Reports page.
    if (typeof setActiveTerm === 'function') {
      courseIds.forEach(function (c) {
        setActiveTerm(c, null);
      });
    }
    var html = '';
    // A remembered tab this class doesn't show opens Details instead.
    if (!_cmTabShown(state.cmTab, state.cmSelectedCourse)) state.cmTab = 'details';
    _cmSyncUrl();

    var detailTitle =
      state.cmMode === 'create'
        ? 'New Class'
        : state.cmSelectedCourse && COURSES[state.cmSelectedCourse]
          ? COURSES[state.cmSelectedCourse].name
          : 'Class Settings';
    // Class Settings belongs to the dashboard: its toolbar is a breadcrumb
    // back to it in place of the dashboard's own toolbar.
    // dashboard.css keys Class Settings' layout on these two classes.
    _cmMark(document.body, 'cm-open', true);
    var toolbarMount = document.getElementById('page-toolbar-mount');
    if (toolbarMount) {
      CmKeepDraw.paint(
        toolbarMount,
        '.cm-toolbar',
        '<div class="page-toolbar dash-toolbar cm-toolbar">' +
          renderBreadcrumb('Dashboard', '/dashboard', 'Class Settings', 'closeClassManager') +
          '<span class="dash-toolbar-spacer"></span>' +
          // The tabbed view names the class in its own header.
          (state.cmMode === 'create' || state.cmRelinkStep > 0
            ? '<span class="cm-toolbar-detail">' + esc(detailTitle) + '</span>'
            : '') +
          '</div>',
      );
    }

    // The class list takes the student list's place beside the page; the
    // dashboard puts the roster back when Class Settings closes.
    var sideMount = document.getElementById('sidebar-mount');
    if (sideMount) {
      sideMount.removeAttribute('data-cid');
      sideMount.style.display = courseIds.length === 0 && state.cmMode !== 'create' ? 'none' : '';
    }

    if (courseIds.length === 0 && state.cmMode !== 'create') {
      html += _cmEmptyStateHtml();
      _cmMark(document.getElementById('main'), 'cm-listing', false);
      /** @type {any} */ (document.getElementById('main')).innerHTML = html;
      return;
    }
    _cmMark(document.getElementById('main'), 'cm-listing', true);

    html += '<div class="cm-layout">';
    if (sideMount) CmKeepDraw.paint(sideMount, '.cm-sidebar', renderCmSidebar(courseIds));
    else html += renderCmSidebar(courseIds);
    html += '<div class="cm-detail">';

    html += _cmDetailHtml();

    html += '</div></div>';
    // Preserve scroll position of the detail pane across re-renders
    var detailEl = document.querySelector('.cm-detail');
    var scrollTop = detailEl ? detailEl.scrollTop : 0;
    var kept = CmKeepMenu.mark([state.cmSelectedCourse, state.cmTab, state.cmMode].join('|'));
    var shape = [
      state.cmMode,
      state.cmSelectedCourse,
      state.cmRelinkStep > 0,
      state.cmCompReview && state.cmCompReview.kind,
      state.cmSelectedCourse && _cmClassReady(state.cmSelectedCourse),
    ].join('|');
    CmKeepDraw.paintMain(document.getElementById('main'), html, shape, state.cmTab);
    if (scrollTop > 0) {
      var newDetail = document.querySelector('.cm-detail');
      if (newDetail) newDetail.scrollTop = scrollTop;
    }
    CmKeepDraw.rosterCue();
    CmKeepMenu.restore(kept, [state.cmSelectedCourse, state.cmTab, state.cmMode].join('|'), _cmFloatOverScroll);
    _cmRestoreKeptFocus();
  }

  /* The badge on a class row: its block ("A"), or the name's initials
     when the block is a longer label or there is none. */
  function _cmClassBadge(c) {
    var b = normalizeCourseBlock(c && c.block);
    if (/^[A-Z0-9]{1,2}$/.test(b)) return b;
    var words = String((c && c.name) || '')
      .split(/\s+/)
      .filter(Boolean);
    return ((words[0] || '?').charAt(0) + (words[1] ? words[1].charAt(0) : '')).toUpperCase();
  }

  // html-safe: badge and name are escaped; meta is built by renderCmSidebar from esc(label) and counts.
  function _cmClassItemHtml(cid, meta, extraClass) {
    var c = COURSES[cid];
    var sel = cid === state.cmSelectedCourse && state.cmMode === 'edit' ? ' selected' : '';
    return (
      '<div class="cm-class-item' +
      sel +
      (extraClass || '') +
      '" data-action="cmSelectClass" data-cid="' +
      cid +
      '">' +
      '<span class="cm-class-avatar" aria-hidden="true" style="background:' +
      (typeof _avatarColor === 'function' ? _avatarColor(cid) : 'var(--text-3)') +
      '">' +
      esc(_cmClassBadge(c)) +
      '</span>' +
      '<span class="cm-class-text">' +
      '<span class="cm-class-name">' +
      esc(c.name || '') +
      '</span>' +
      '<span class="cm-class-meta">' +
      meta +
      '</span>' +
      '</span>' +
      '</div>'
    );
  }

  function _cmStudentCount(n) {
    return n + ' Student' + (n !== 1 ? 's' : '');
  }

  // html-safe: counts and fixed markup; block labels are escaped; rows come from _cmClassItemHtml.
  function renderCmSidebar(courseIds) {
    var html =
      '<aside class="cm-sidebar" aria-label="Classes">' +
      '<div class="cm-sidebar-header cm-bar">' +
      '<span class="cm-sidebar-title">Classes</span>' +
      // New Class sits at the top of the class list, as a button (in place
      // of the class count, which the list itself shows).
      '<button type="button" class="tb-action-btn tb-action-secondary cm-new-class-btn" data-action="cmStartCreate">+ New Class</button>' +
      '</div>' +
      '<div class="cm-class-list">';
    if (state.cmMode === 'create') {
      html +=
        '<div class="cm-class-item cm-create-active">' +
        '<span class="cm-class-avatar cm-class-avatar-new" aria-hidden="true">+</span>' +
        '<span class="cm-class-text">' +
        '<span class="cm-class-name">New Class</span>' +
        '<span class="cm-class-meta">Setting up…</span>' +
        '</span>' +
        '</div>';
    }
    var activeCids = sortCoursesByBlock(
      courseIds
        .filter(function (cid) {
          return !isCourseArchived(cid);
        })
        .map(function (cid) {
          return Object.assign({}, COURSES[cid], { id: cid });
        }),
    ).map(function (c) {
      return c.id;
    });
    var archivedCids = courseIds.filter(function (cid) {
      return isCourseArchived(cid);
    });
    activeCids.forEach(function (cid) {
      var ready = _cmClassReady(cid);
      var label = courseBlockLabel(COURSES[cid]);
      var meta = (label ? esc(label) + ' · ' : '') + (ready ? _cmStudentCount(getStudents(cid).length) : 'Loading…');
      html += _cmClassItemHtml(cid, meta);
    });
    if (archivedCids.length > 0) {
      html += '<div class="cm-class-group">Archived</div>';
      archivedCids.forEach(function (cid) {
        html += _cmClassItemHtml(cid, _cmStudentCount(getStudents(cid).length) + ' · Archived', ' archived');
      });
    }
    html +=
      '</div>' +
      '<div class="cm-sidebar-foot">' +
      '<button type="button" class="cm-new-btn" data-action="cmRestoreBackup">Restore from Backup</button>' +
      '</div>' +
      '</aside>';
    return html;
  }

  /* The header, the tabs and the open tab's panel, the only panel built.
     What a closed tab did besides drawing still happens: questionnaires and
     categories are asked for, and an open student preview follows the class. */
  function renderCmDetail(cid) {
    var studentCount = getStudents(cid).length;
    var assessCount = getAssessments(cid).length;
    var tagCount = getAllTags(cid).length;
    _cmLoadGuardians(cid);
    var qn = typeof CmQuestionnaires !== 'undefined';
    var sp = _cmTabShown('student-page', cid);
    var build = {
      details: _cmDetailsPanel,
      students: _cmStudentsPanel,
      questionnaires: qn && CmQuestionnaires.render,
      'student-page': sp && CmStudentPage.render,
      grading: _cmRenderGradingTab,
      terms: _cmTermsPanel,
      competencies: _cmCompetenciesPanel,
    };
    var tab = build[state.cmTab] ? state.cmTab : 'details';
    if (qn && tab !== 'questionnaires') CmQuestionnaires.prepare(cid);
    if (sp && tab !== 'student-page') CmStudentPage.followPreview(cid);
    if (tab !== 'grading') _cmCatPrepare(cid, _cmCatState(cid));
    var panel = build[tab](cid);
    return (
      '<div class="cm-detail-inner cm-tabbed' +
      (tab === 'students' ? ' cm-tabbed-wide' : '') +
      '">' +
      _cmRenderHeader(cid, studentCount, assessCount, tagCount) +
      _cmRenderTabs(tab) +
      '<div class="cm-tab-panel cm-tab-panel-' +
      tab +
      '" role="tabpanel" id="cm-tabpanel" aria-labelledby="cm-tab-' +
      tab +
      '">' +
      panel +
      '</div>' +
      '</div>'
    );
  }

  function _cmDetailsPanel(cid) {
    var course = COURSES[cid];
    return (
      '<div class="cm-section">' +
      '<div class="cm-section-title">Class Details</div>' +
      '<div class="cm-details-row">' +
      '<div class="cm-field">' +
      '<label class="cm-label" for="cm-name">Class Name</label>' +
      '<input class="cm-input" id="cm-name" value="' +
      esc(course.name) +
      '" data-action-blur="cmUpdateName">' +
      '</div>' +
      '<div class="cm-field">' +
      '<label class="cm-label" for="cm-grade">Grade Level</label>' +
      '<input class="cm-input" id="cm-grade" value="' +
      esc(course.gradeLevel || '') +
      '" placeholder="e.g. 10-12" data-action-blur="cmUpdateGrade">' +
      '</div>' +
      '</div>' +
      '<div class="cm-field">' +
      '<label class="cm-label" id="cm-block-label">Block</label>' +
      blockPickerHtml('cm-block', course.block) +
      '</div>' +
      '<div class="cm-field">' +
      '<label class="cm-label">Description</label>' +
      '<textarea class="cm-textarea" id="cm-desc" placeholder="Optional course description\u2026" data-action-blur="cmUpdateDesc">' +
      esc(course.description || '') +
      '</textarea>' +
      '</div>' +
      // Late Work Policy: free text, optional. Printed reports show it in
      // the Score Distribution block.
      '<div class="cm-field">' +
      '<label class="cm-label" for="cm-late-policy">Late Work Policy</label>' +
      '<textarea class="cm-textarea" id="cm-late-policy" rows="2" placeholder="e.g. Late assignments lose 10% per day, up to 3 days." data-action-blur="cmLateWorkPolicy">' +
      esc(course.lateWorkPolicy || '') +
      '</textarea>' +
      '<div class="cm-hint">Optional. Printed reports with a Score Distribution block show it.</div>' +
      '</div>' +
      '</div>'
    );
  }

  // Students tab: a toolbar (for an empty class, where the class list goes:
  // cmImportEmptyHtml), the roster edited in place, then Withdrawn.
  function _cmStudentsPanel(cid) {
    var students = getStudents(cid);
    var html =
      _cmImportDoneHtml(cid) +
      (students.length
        ? '<div class="cm-roster-bar cm-bar">' +
          '<div class="cm-rs-tools">' +
          '<div class="atb-search cm-rs-search"><div class="atb-field">' +
          '<span class="assess-search-icon atb-ico atb-ico-search" aria-hidden="true"></span>' +
          '<input type="text" placeholder="Find a Student" aria-label="Find a Student" data-action-input="cmRosterSearch" value="' +
          esc(state.cmRosterQuery) +
          '"></div></div>' +
          '<span class="cm-hint cm-rs-summary" id="cm-rs-more" hidden>Scroll sideways for more columns.</span>' +
          '<span class="cm-hint cm-rs-summary" id="cm-rs-summary">' +
          esc(_cmRosterSummary(cid)) +
          '</span>' +
          '</div>' +
          '<div class="cm-roster-buttons">' +
          '<button type="button" class="tb-action-btn tb-action-secondary" data-action="cmImportRoster">Import Roster</button>' +
          '<button type="button" class="tb-action-btn cm-roster-add" data-action="cmShowAddStudent">Add Student</button>' +
          '</div>' +
          '</div>'
        : '') +
      '<input type="file" id="cm-csv-input" accept=".csv,.txt,.tsv,.xlsx,.xls" hidden data-action-change="cmCSV">' +
      '<div id="cm-import-preview">' +
      (state.cmImportError
        ? _cmImportErrorHtml(state.cmImportError)
        : state.cmPendingImport
          ? _cmRenderImportReview(cid)
          : state.cmImportFormatOpen && students.length
            ? cmImportFormatHtml()
            : !students.length
              ? cmImportEmptyHtml()
              : '') +
      '</div>';
    var rosterHtml = students.length ? _cmRosterHtml(cid) : '';
    // Add/Edit student form
    html +=
      '<div id="cm-add-student-form" style="display:none" class="cm-add-student-form">' +
      '<div class="cm-student-form">' +
      '<div class="cm-field"><label class="cm-label" for="cm-add-first">First Name *</label><input class="cm-input" id="cm-add-first" placeholder="e.g. Amara" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label" for="cm-add-last">Last Name</label><input class="cm-input" id="cm-add-last" placeholder="e.g. Osei" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label" for="cm-add-pref">Preferred Name</label><input class="cm-input" id="cm-add-pref" placeholder="e.g. Amara" style="font-size:0.875rem;padding:6px 10px"></div>' +
      // Pronouns take the same list and free text as the roster's box.
      '<div class="cm-field"><label class="cm-label" for="cm-add-pro">Pronouns</label>' +
      '<input class="cm-input" id="cm-add-pro" list="cm-add-pronouns" autocomplete="off" style="font-size:0.875rem;padding:6px 10px">' +
      '<datalist id="cm-add-pronouns">' +
      PRONOUNS_OPTIONS.map(function (p) {
        return '<option value="' + esc(p) + '">';
      }).join('') +
      '</datalist>' +
      '</div>' +
      '<div class="cm-field"><label class="cm-label" for="cm-add-num">Student Number</label><input class="cm-input" id="cm-add-num" placeholder="e.g. STU-101" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label" for="cm-add-email">Email</label><input class="cm-input" id="cm-add-email" type="email" placeholder="student@school.edu" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label" for="cm-add-dob">Date of Birth</label><input class="cm-input" id="cm-add-dob" type="date" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field" style="grid-column:1/-1"><label class="cm-label">Designations</label>' +
      '<div class="desig-check-grid">' +
      Object.entries(BC_DESIGNATIONS)
        .map(function (entry) {
          var k = entry[0],
            v = entry[1];
          return (
            '<label class="desig-check-item" title="' +
            esc(v.desc) +
            '"><input type="checkbox" class="cm-desig-check" value="' +
            k +
            '"><span class="desig-check-code">' +
            k +
            '</span><span class="desig-check-name">' +
            esc(v.name) +
            '</span></label>'
          );
        })
        .join('') +
      '</div>' +
      '</div>' +
      '<div class="cm-field" style="grid-column:1/-1"><label class="cm-label">Language Support</label>' +
      '<div class="desig-check-grid">' +
      Object.entries(SUPPORT_FLAGS)
        .map(function (entry) {
          var k = entry[0],
            v = entry[1];
          return (
            '<label class="desig-check-item" title="' +
            esc(v.desc) +
            '"><input type="checkbox" class="cm-desig-check" value="' +
            k +
            '"><span class="desig-check-code">' +
            k +
            '</span><span class="desig-check-name">' +
            esc(v.name) +
            '</span></label>'
          );
        })
        .join('') +
      '</div>' +
      '</div>' +
      '<div class="cm-field" style="grid-column:1/-1;display:flex;align-items:flex-end;gap:8px;justify-content:flex-end">' +
      '<span class="cm-hint" id="cm-add-status" role="status" aria-live="polite" style="margin-right:auto;align-self:center"></span>' +
      '<button class="btn btn-ghost" data-action="cmCancelStudent" style="padding:6px 10px;font-size:0.8125rem">Cancel</button>' +
      '<button class="btn btn-ghost" id="cm-save-another-btn" data-action="cmSaveStudentAndAnother" style="padding:6px 14px;font-size:0.8125rem">Save and Add Another</button>' +
      '<button class="btn btn-primary" id="cm-save-btn" data-action="cmSaveStudent" style="padding:6px 14px;font-size:0.8125rem">Save</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      rosterHtml +
      renderWithdrawnList(cid);
    return html;
  }

  function _cmTermsPanel() {
    return '<div class="cm-section">' + _cmRenderReportingTermsField(state.cmSelectedCourse) + '</div>';
  }

  // Competencies tab: a toolbar and the list, beside the curriculum and subjects.
  function _cmCompetenciesPanel(cid) {
    var course = COURSES[cid];
    var lm = getLearningMap(cid);
    var html = '<div class="cm-section cm-comp-side-card">' + '<h2 class="cm-grade-title">Subjects</h2>';
    (lm.subjects || []).forEach(function (sub) {
      html +=
        '<div class="cm-subject-row">' +
        '<div class="cm-subject-color" style="background:' +
        sub.color +
        '">' +
        '<div class="cm-color-swatch-selected" style="background:' +
        sub.color +
        '" data-action="cmToggleColorPalette" data-target="subject" data-subid="' +
        sub.id +
        '"></div>' +
        '<div class="cm-color-palette" id="cm-palette-subject-' +
        sub.id +
        '"></div>' +
        '</div>' +
        '<input class="cm-input" value="' +
        esc(sub.name) +
        '" style="flex:1" data-action-blur="cmSubjectName" data-subid="' +
        sub.id +
        '">' +
        '<button class="cm-delete-mini" data-action="cmDeleteSubject" data-subid="' +
        sub.id +
        '" title="Delete subject" aria-label="Delete subject">\u2715</button>' +
        '</div>';
    });
    html += '<button class="cm-add-link" data-action="cmAddSubject">+ Add Subject</button></div>';
    var subjectsHtml = html;
    html = '';

    // Learning Standards — folder-based UI (mirrors assignments page)
    var compGroups = lm.competencyGroups || [];
    /** @type {any} */
    var _cmGrouped = { groups: [], ungrouped: [] };
    var _cmGroupMap = {};
    compGroups.forEach(function (g) {
      _cmGroupMap[g.id] = { group: g, sections: [] };
    });
    (lm.sections || []).forEach(function (sec) {
      if (sec.groupId && _cmGroupMap[sec.groupId]) _cmGroupMap[sec.groupId].sections.push(sec);
      else _cmGrouped.ungrouped.push(sec);
    });
    _cmGrouped.groups = compGroups.map(function (g) {
      return _cmGroupMap[g.id];
    });

    html += _cmRenderCompToolbar(cid, lm, compGroups) + '<div class="cm-section cm-comp-list">';

    if ((lm.sections || []).length === 0 && compGroups.length === 0) {
      html +=
        '<div class="cm-curriculum-empty">' +
        '<div class="cm-curriculum-empty-text">No competencies yet. Add one to start building this class\u2019s curriculum.</div>' +
        '</div>';
    }

    // Each folder's Counts as One only matters while the class counts
    // folders as one, so with that off the switches go and this says why.
    var foldersCount = getFoldersCountAsOne(cid);
    if (!foldersCount && compGroups.length > 0) {
      html +=
        '<div class="cm-hint cm-folder-count-off">Every competency counts the same in the overall, so folders only group them (How Folders Count, beside the list).</div>';
    }

    // Competencies outside folders sit where their order puts them among
    // the folders (Ministry order for an imported class: Understanding
    // Context before Defining), each run a drop target for "no folder".
    var _cmSecIndex = {};
    (lm.sections || []).forEach(function (sec, i) {
      _cmSecIndex[sec.id] = i;
    });
    var _cmLoose = _cmGrouped.ungrouped.slice();
    function _cmLooseRun(before) {
      var run = [];
      while (_cmLoose.length && (before == null || _cmSecIndex[_cmLoose[0].id] < before)) run.push(_cmLoose.shift());
      if (!run.length) return '';
      return (
        '<div class="mod-folder no-module open cm-loose-run" data-folder-drop="__none__"><div class="mod-folder-body">' +
        run
          .map(function (sec) {
            return _cmRenderStdCard(sec, lm, compGroups);
          })
          .join('') +
        '</div></div>'
      );
    }

    // Render group folders (reuses .mod-folder pattern from assignments page)
    _cmGrouped.groups.forEach(function (gi) {
      var grp = /** @type {any} */ (gi).group;
      var secs = /** @type {any} */ (gi).sections;
      if (secs.length)
        html += _cmLooseRun(
          Math.min.apply(
            null,
            secs.map(function (s) {
              return _cmSecIndex[s.id];
            }),
          ),
        );
      var isOpen = !state._cmCollapsedStdFolders[grp.id];
      html +=
        '<div class="mod-folder' +
        (isOpen ? ' open' : '') +
        '" data-module-id="' +
        grp.id +
        '" data-folder-drop="' +
        grp.id +
        '">' +
        '<div class="mod-folder-header" data-action="cmToggleStdFolder" data-uid="' +
        grp.id +
        '">' +
        '<span class="mod-folder-grip">\u2807</span>' +
        '<span class="mod-folder-chevron">\u25B6</span>' +
        '<button type="button" class="mod-folder-color" style="background:' +
        cssColor(grp.color) +
        '" title="Change colour" aria-label="Change colour" aria-haspopup="dialog" draggable="false"' +
        ' data-action="cmOpenGroupColorPop" data-grpid="' +
        grp.id +
        '" data-stop-prop="true"></button>' +
        '<input class="mod-folder-name-input" value="' +
        esc(grp.name) +
        '" draggable="false" data-stop-prop="true" data-action-blur="cmCompGroupName" data-grpid="' +
        grp.id +
        '">' +
        '<span class="mod-folder-meta">' +
        secs.length +
        (secs.length !== 1 ? ' Competencies' : ' Competency') +
        '</span>' +
        '<div class="mod-folder-actions" data-stop-prop="true">' +
        (foldersCount
          ? '<label class="cm-folder-count" title="On: this folder is averaged first and counts as one competency in the overall. Off: each competency in it counts on its own.">' +
            '<span class="cm-folder-count-text">Counts as One</span>' +
            '<span class="gpd-switch"><input type="checkbox" role="switch" aria-label="' +
            esc(grp.name + ' Counts as One') +
            '" data-action-change="cmFolderCountsAsOne" data-grpid="' +
            grp.id +
            '"' +
            (grp.countsAsOne !== false ? ' checked' : '') +
            '><span class="gpd-switch-ui" aria-hidden="true"></span></span>' +
            '</label>'
          : '') +
        '<button class="mod-folder-action delete" data-action="cmDeleteCompGroup" data-grpid="' +
        grp.id +
        '" data-count="' +
        secs.length +
        '" title="Delete group">\u2715</button>' +
        '</div>' +
        '</div>' +
        '<div class="mod-folder-body">';
      if (secs.length === 0) {
        html +=
          '<div class="mod-folder-empty">Drag competencies here, or choose this folder on a competency\u2019s card.</div>';
      }
      secs.forEach(function (sec) {
        html += _cmRenderStdCard(sec, lm, compGroups);
      });
      html += '</div></div>';
    });

    // The rest of the competencies outside folders, after the last folder.
    // With none, the Ungrouped drop target stays so a card can leave its
    // folder.
    if (compGroups.length > 0 && _cmGrouped.ungrouped.length > 0) {
      html += _cmLooseRun(null);
    } else if (compGroups.length > 0) {
      var ungOpen = !state._cmCollapsedStdFolders['__none__'];
      html +=
        '<div class="mod-folder no-module' +
        (ungOpen ? ' open' : '') +
        '" data-module-id="__none__" data-folder-drop="__none__">' +
        '<div class="mod-folder-header" data-action="cmToggleStdFolder" data-uid="__none__">' +
        '<span class="mod-folder-chevron">\u25B6</span>' +
        '<span class="mod-folder-name" style="font-size:0.95rem;font-weight:500;color:var(--text-3)">Ungrouped</span>' +
        '<span class="mod-folder-meta">' +
        _cmGrouped.ungrouped.length +
        (_cmGrouped.ungrouped.length !== 1 ? ' Competencies' : ' Competency') +
        '</span>' +
        '</div>' +
        '<div class="mod-folder-body">';
      _cmGrouped.ungrouped.forEach(function (sec) {
        html += _cmRenderStdCard(sec, lm, compGroups);
      });
      if (_cmGrouped.ungrouped.length === 0) {
        html += '<div class="mod-folder-empty">Every competency is in a folder</div>';
      }
      html += '</div></div>';
    } else {
      // No groups at all — render flat
      (lm.sections || []).forEach(function (sec) {
        html += _cmRenderStdCard(sec, lm, compGroups);
      });
    }

    html += '</div>';
    var compHtml = html;
    html = '';

    // BC Curriculum Link
    var linkedTags = course.curriculumTags || [];
    html += '<div class="cm-section cm-comp-side-card">' + '<h2 class="cm-grade-title">BC Curriculum Link</h2>';
    if (linkedTags.length > 0) {
      linkedTags.forEach(function (tag) {
        var courseData = CURRICULUM_INDEX ? CURRICULUM_INDEX[tag] : null;
        var tagSubject = (lm.subjects || []).find(function (sub) {
          return sub.id === tag;
        });
        var courseName = courseData ? courseData.course_name : tagSubject ? tagSubject.name : tag;
        html +=
          '<div class="cm-curric-link">' +
          '<span class="cm-curric-tag">' +
          esc(tag) +
          '</span>' +
          '<span class="cm-curric-name">' +
          esc(courseName) +
          '</span>' +
          '</div>';
      });
      html +=
        '<button class="cm-relink-btn" data-action="cmStartRelink" data-cid="' +
        cid +
        '">Re-link Curriculum</button>' +
        '<div class="cm-hint">You\u2019ll see what changes before anything is applied. Nothing you edited is overwritten.</div>';
    } else {
      html +=
        '<div class="cm-curric-unlinked">Not linked to BC Curriculum</div>' +
        '<button class="cm-relink-btn" data-action="cmStartRelink" data-cid="' +
        cid +
        '">Link to BC Curriculum</button>';
    }
    html += '</div>';
    // Select mode is the list alone.
    return state.cmCompSelect
      ? '<div class="cm-comp-layout cm-comp-selecting"><div class="cm-comp-main">' + compHtml + '</div></div>'
      : '<div class="cm-comp-layout"><div class="cm-comp-main">' +
          compHtml +
          '</div><div class="cm-comp-side">' +
          html +
          _cmRenderFoldersCountAsOne(cid) +
          subjectsHtml +
          '</div></div>';
  }

  /* \u2500\u2500 Class header and tabs \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
     The class's name and counts, Open Gradebook, and the ⋯ Class Actions menu. */
  function _cmRenderHeader(cid, studentCount, assessCount, tagCount) {
    var course = COURSES[cid];
    var isArchived = isCourseArchived(cid);
    var meta = [];
    var block = typeof courseBlockLabel === 'function' ? courseBlockLabel(course) : '';
    if (block) meta.push(block);
    if (course.gradeLevel) meta.push('Grade ' + course.gradeLevel);
    meta.push(studentCount + ' Student' + (studentCount !== 1 ? 's' : ''));
    meta.push(assessCount + ' Assessment' + (assessCount !== 1 ? 's' : ''));
    meta.push(tagCount + ' Competenc' + (tagCount !== 1 ? 'ies' : 'y'));
    return (
      '<div class="cm-head">' +
      '<div class="cm-head-text">' +
      '<h1 class="cm-head-title">' +
      esc(course.name) +
      '</h1>' +
      '<div class="cm-head-meta">' +
      esc(meta.join(' \u00B7 ')) +
      (isArchived ? ' \u00B7 Archived' : '') +
      '</div>' +
      '</div>' +
      '<div class="cm-head-actions cm-bar">' +
      '<button type="button" class="tb-action-btn tb-action-secondary" data-action="cmOpenGradebook" data-cid="' +
      cid +
      '">Open Gradebook</button>' +
      '<div class="cm-std-menu-wrap">' +
      '<button type="button" class="atb-icon-btn" data-action="cmStdMenu" aria-haspopup="menu" aria-expanded="false" aria-label="Class Actions" title="Class Actions"><span class="atb-ico atb-ico-dots" aria-hidden="true"></span></button>' +
      '<div class="cm-std-menu cm-class-actions-menu" role="menu" hidden>' +
      '<button type="button" role="menuitem" class="cm-std-menu-item" data-action="cmDuplicateCourse" data-cid="' +
      cid +
      '">' +
      LINE_ICONS.copy +
      '<span>Duplicate Class</span></button>' +
      '<button type="button" role="menuitem" class="cm-std-menu-item" data-action="cmDownloadBackup" data-cid="' +
      cid +
      '">' +
      LINE_ICONS.download +
      '<span>Download Class Backup</span></button>' +
      '<span class="cm-std-menu-sep" role="separator"></span>' +
      '<button type="button" role="menuitem" class="cm-std-menu-item' +
      (isArchived ? '' : ' danger') +
      '" data-action="cmToggleArchive" data-cid="' +
      cid +
      '">' +
      LINE_ICONS.archive +
      (isArchived ? '<span>Unarchive Class</span>' : '<span>Archive Class</span>') +
      '</button>' +
      (isArchived
        ? '<button type="button" role="menuitem" class="cm-std-menu-item danger" data-action="cmDeleteCourse" data-cid="' +
          cid +
          '">' +
          LINE_ICONS.trash +
          '<span>Delete Class</span></button>'
        : '<div class="cm-class-actions-note">Delete Class appears here once a class is archived.</div>') +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  /* A tab marked `hidden` is not there: no button in the tab bar, no way in
     by click, arrow key, address or remembered tab, and its panel is never
     built. `hidden` is true, or a function of the class id for a tab some
     classes show. Student Page (teacher/cm-student-page.js) decides its own
     and is hidden for every class until S1-F4
     (docs/plans/student-page-build-plan.md). */
  var CM_TABS = [
    { id: 'details', label: 'Details' },
    { id: 'students', label: 'Students' },
    { id: 'questionnaires', label: 'Reflect' },
    {
      id: 'student-page',
      label: 'Student Page',
      hidden: function (cid) {
        return typeof CmStudentPage === 'undefined' || CmStudentPage.isShown(cid) !== true;
      },
    },
    { id: 'grading', label: 'Grading' },
    { id: 'terms', label: 'Reporting Terms' },
    { id: 'competencies', label: 'Competencies' },
  ];

  function _cmTabHidden(t, cid) {
    return !!(typeof t.hidden === 'function' ? t.hidden(cid) : t.hidden);
  }

  // The tabs a class shows, in order.
  function _cmShownTabs(cid) {
    return CM_TABS.filter(function (t) {
      return !_cmTabHidden(t, cid);
    });
  }

  function _cmTabShown(tab, cid) {
    return _cmShownTabs(cid).some(function (t) {
      return t.id === tab;
    });
  }

  function _cmRenderTabs(active) {
    return (
      '<div class="cm-tabs" role="tablist" aria-label="Class settings">' +
      CM_TABS.map(function (t) {
        if (_cmTabHidden(t, state.cmSelectedCourse)) return '';
        var on = t.id === active;
        return (
          '<button type="button" class="cm-tab' +
          (on ? ' active' : '') +
          '" role="tab" id="cm-tab-' +
          t.id +
          '" aria-selected="' +
          on +
          '" aria-controls="cm-tabpanel" tabindex="' +
          (on ? '0' : '-1') +
          '" data-action="cmSetTab" data-tab="' +
          t.id +
          '">' +
          t.label +
          '</button>'
        );
      }).join('') +
      '</div>'
    );
  }

  function cmSetTab(tab) {
    if (!_cmTabShown(tab, state.cmSelectedCourse)) return;
    state.cmTab = tab;
    // A school picked but not used goes back to the class's own.
    if (state.cmSelectedCourse) delete _cmTermSchool[state.cmSelectedCourse];
    renderClassManager();
    var detail = document.querySelector('.cm-detail');
    if (detail) detail.scrollTop = 0;
    var btn = document.getElementById('cm-tab-' + tab);
    if (btn && typeof btn.focus === 'function') btn.focus({ preventScroll: true });
  }

  function cmOpenGradebook(cid) {
    if (!cid || !COURSES[cid]) return;
    state.classManagerOpen = false;
    _cmNoteOpened(cid);
    if (typeof setActiveCourse === 'function') setActiveCourse(cid);
    if (typeof Router !== 'undefined' && Router.navigate) Router.navigate('/gradebook');
  }

  return {
    configure: configure,
    _cmNoteOpened: _cmNoteOpened,
    _cmRefreshSidebar: _cmRefreshSidebar,
    _cmShowWhenLoaded: _cmShowWhenLoaded,
    _cmShownTabs: _cmShownTabs,
    _cmTabShown: _cmTabShown,
    _cwCourseRow: _cwCourseRow,
    _cwSeg: _cwSeg,
    _cwSetRow: _cwSetRow,
    blockChipSelect: blockChipSelect,
    blockOtherInput: blockOtherInput,
    blockPickerHtml: blockPickerHtml,
    closeClassManager: closeClassManager,
    cmOpenDemoMode: cmOpenDemoMode,
    cmOpenGradebook: cmOpenGradebook,
    cmSetTab: cmSetTab,
    openClassManager: openClassManager,
    readBlockPicker: readBlockPicker,
    renderClassManager: renderClassManager,
  };
})();
