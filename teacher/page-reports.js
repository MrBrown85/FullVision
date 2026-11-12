/* == page-reports.js -- Reports page module ================ */
window.PageReports = (function () {
  'use strict';

  /* ── The report's set of scores ──────────────────────────────────
     Which grades a report is drawn from is chosen in one place,
     teacher/report-scores.js (student page build plan, S2-T1). This page
     never decides it and never reads a score. Each function below that
     draws or measures a Progress Report runs inside
     ReportScores.withReportScores every time it is called: from a click,
     the resize timer, the class-fit timer, the palette's peek timer or a
     promise alike, because the function itself is wrapped, not the code
     that schedules it. The blocks, the Quick Report, the questionnaire and
     the phone copies wrap themselves the same way in their own files.
     What this page keeps to draw faster (the template pictures, the block
     heights, the class fit, the last render's summary) is keyed by the
     set, _reportSet(). */
  var _inReportScores = function (fn) {
    return ReportScores.scoped('progress', fn);
  };
  renderReportPreview = _inReportScores(renderReportPreview);
  renderStudioPanels = _inReportScores(renderStudioPanels);
  _templateThumbs = _inReportScores(_templateThumbs);
  _measureBlockSizes = _inReportScores(_measureBlockSizes);
  _classSummary = _inReportScores(_classSummary);
  _blockHtml = _inReportScores(_blockHtml);
  _draftsInPrint = _inReportScores(_draftsInPrint);
  function _reportSet() {
    return ReportScores.reportScoreSet('progress');
  }

  /* -- Listener tracking for cleanup ---------------------- */
  var _listeners = [];
  function _addDocListener(type, handler, options) {
    document.addEventListener(type, handler, options);
    _listeners.push({ type: type, handler: handler, options: options });
  }

  var _beforeUnloadHandler = null;
  var Preview = ReportPreview;

  /* ══════════════════════════════════════════════════════════════
   REPORTS PAGE — Logic
   ══════════════════════════════════════════════════════════════ */

  /* ── The tabs ────────────────────────────────────────────────────
     Reports hosts the tabs in this list, in the order the bar shows them.
     A new tab is one more entry; nothing else on the page names a tab to
     decide what to draw.
       id, label, title   its name in the address (?tab=) and on its button,
                          the button's words and its tooltip
       hidden             true keeps an unfinished tab off the bar and out
                          of the address: no button, and ?tab= can't open it
       show(on)           shows its own toolbar controls when it opens;
                          hides them and puts back what it changed when
                          another tab opens
       render(cid, output)  draws it into #report-output
       teardown()         clears what it left behind when the page closes
     and, only where a tab needs one: address() (what it adds to the
     address), longForm() (its comment box, for a sign-in that expires
     mid-sentence), printButton (true shows the toolbar's Print Reports)
     with print() for what it does, key(e), resize() and pickStudent(sid)
     (a click on the roster). The first tab that isn't hidden is the one Reports
     opens on, and the one a hidden tab's id opens. */
  var TABS = [
    {
      id: 'questionnaire',
      label: 'Term Questionnaire',
      title: 'Write and approve each student’s report comment.',
      hidden: false,
      show: _showQuestionnaireTab,
      render: _renderQuestionnaireTab,
      teardown: _teardownQuestionnaireTab,
      address: function () {
        var st = RQ.getTqStudents()[RQ.tqStudentIndex];
        return st ? '&student=' + encodeURIComponent(st.id) : '';
      },
      longForm: function () {
        return {
          kind: 'term-rating',
          getDraftText: function () {
            var box = document.getElementById('tq-narrative');
            return box ? box.value || '' : '';
          },
        };
      },
      /* ⌘ Return and the arrow keys on the questionnaire. */
      key: function (e) {
        RQ.handleKey(e);
      },
      // The questionnaire's comment box refits its height to the new width.
      resize: function () {
        RQ.fitBox();
      },
      pickStudent: function (sid) {
        tqSelectStudent(sid);
      },
    },
    {
      id: 'progress',
      label: 'Progress Reports',
      title: 'Build and print the class’s report cards.',
      hidden: false,
      show: _showProgressTab,
      render: _renderProgressTab,
      teardown: _teardownProgressTab,
      printButton: true,
      print: function () {
        openIssueDialog();
      },
      resize: function () {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(function () {
          if (_mounted) renderReportPreview();
        }, 150);
      },
      pickStudent: function (sid) {
        selectedStudentIds = [sid];
        populateStudentSelect();
        renderReports();
      },
    },
  ];

  function _shownTabs(tabs) {
    return tabs.filter(function (t) {
      return !t.hidden;
    });
  }

  /* An address that names a tab the list doesn't have (?tab=bogus). This
     is what the page has always done with one, kept as it is and not
     endorsed: Progress Reports' canvas is drawn with the first tab's button
     still lit, Print Reports is the only tab control showing and prints
     without the dialog, a roster click opens that student's questionnaire,
     and the address keeps the stray name. It is not in TABS, so it has no
     button. Fixing it (open the first tab instead) is its own change. */
  var UNKNOWN_TAB = {
    printButton: true,
    render: _renderProgressTab,
    pickStudent: function (sid) {
      tqSelectStudent(sid);
    },
  };

  /* The tab an id opens. A tab on the bar opens itself. A hidden tab's id,
     or no id, opens the first tab on the bar: a hidden tab can't be opened.
     An id the list doesn't have at all gets UNKNOWN_TAB. */
  function _tabFor(tabs, id) {
    var shown = _shownTabs(tabs);
    var named = tabs.find(function (t) {
      return t.id === id;
    });
    if (named) return named.hidden ? shown[0] : named;
    return id ? UNKNOWN_TAB : shown[0];
  }

  /* The name kept for the open tab, in activeTab and the address: the
     tab's own id, or the stray name as it came for UNKNOWN_TAB. */
  function _tabIdFor(tabs, id) {
    var t = _tabFor(tabs, id);
    return t === UNKNOWN_TAB ? id : t.id;
  }

  /* The bar's buttons, one for each tab that isn't hidden. The first is
     drawn selected; switchTab moves the selection when the page opens. */
  // html-safe: fixed markup around each tab's id, tooltip and label from the TABS list, all through esc
  function _tabBarHtml(tabs) {
    return _shownTabs(tabs)
      .map(function (t, i) {
        return (
          '<button class="seg-btn report-seg-btn' +
          (i === 0 ? ' active' : '') +
          '" data-action="switchTab" data-tab="' +
          esc(t.id) +
          '" role="tab" aria-selected="' +
          (i === 0 ? 'true' : 'false') +
          '" title="' +
          esc(t.title) +
          '">' +
          esc(t.label) +
          '</button>'
        );
      })
      .join('\n        ');
  }

  var activeCourse;
  var activeTab = _tabIdFor(TABS);
  var phonesView = false; // Progress Reports › Sent to Phones (teacher/phone-reports.js)

  // The open tab's entry.
  function _tab() {
    return _tabFor(TABS, activeTab);
  }

  /* ══════════════════════════════════════════════════════════════
   REPORT BUILDER — Config, presets, persistence
   ══════════════════════════════════════════════════════════════ */
  var reportConfig = null;

  /* ── Block renderers + helpers now in report-blocks.js ────── */
  var getPronouns = ReportBlocks.getPronouns;
  var getTermId = ReportBlocks.getTermId;
  var renderReportBlock = ReportBlocks.renderReportBlock;

  /* ── Paper ───────────────────────────────────────────────────────
     Letter or Legal for the printed reports, remembered per class on this
     device. reports.css fixes @page to Letter; a Legal choice appends a
     style element that overrides it, the way rubric-print.js does for its
     layouts. DECISIONS.md, "Report forms" 4. */
  var PAPER_STYLE_ID = 'report-paper-style';
  var PAPER_SIZES = { letter: 'letter portrait', legal: 'legal portrait' };
  var reportPaper = 'letter';

  function _loadPaper(cid) {
    try {
      var v = localStorage.getItem('gb-report-paper-' + cid);
      return PAPER_SIZES[v] ? v : 'letter';
    } catch (e) {
      return 'letter';
    }
  }

  function _applyPaper() {
    var style = document.getElementById(PAPER_STYLE_ID);
    // The Report Card form's sheets carry their own margins and set the
    // page size themselves when they render (ReportSheets.renderPreview).
    var sheets = true;
    if (reportPaper === 'letter' || sheets) {
      if (style) style.remove();
    } else {
      if (!style) {
        style = document.createElement('style');
        style.id = PAPER_STYLE_ID;
        document.head.appendChild(style);
      }
      style.textContent = '@media print { @page { size: ' + PAPER_SIZES[reportPaper] + '; margin: 0.5in; } }';
    }
    document.querySelectorAll('#report-paper .seg-btn').forEach(function (b) {
      var on = b.dataset.paper === reportPaper;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function setPaper(paper) {
    if (!PAPER_SIZES[paper]) return;
    reportPaper = paper;
    try {
      if (paper === 'letter') localStorage.removeItem('gb-report-paper-' + activeCourse);
      else localStorage.setItem('gb-report-paper-' + activeCourse, paper);
    } catch (e) {
      /* per-device preference only */
    }
    _applyPaper();
    if (activeTab === 'progress') renderReportPreview();
  }

  function _syncSidesButtons() {
    var n = _formOf().sides.length > 1 ? '2' : '1';
    document.querySelectorAll('#report-sides .seg-btn').forEach(function (b) {
      var on = b.dataset.sides === n;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  /* ── Tab switching ───────────────────────────────────────────── */
  function switchTab(tab) {
    // A comment typed in the last moment is saved before the page changes.
    RQ.tqSaveCurrentIfNeeded();
    activeTab = _tabIdFor(TABS, tab);
    viewingIssue = null;
    segSelect(document.querySelector('.report-seg-btn[data-tab="' + activeTab + '"]'));
    // Show/hide contextual toolbar elements
    var open = _tab();
    TABS.forEach(function (t) {
      if (t.show) t.show(t === open);
    });
    const tbPrint = document.getElementById('tb-print-btn');
    if (tbPrint) tbPrint.style.display = open.printButton ? '' : 'none';
    var layout = document.getElementById('page-layout');
    if (layout) layout.classList.toggle('sidebar-hidden', !_sidebarIsVisible());
    renderReports();
  }

  function _showQuestionnaireTab(on) {
    document.querySelectorAll('.tq-only').forEach(function (el) {
      el.style.display = on ? '' : 'none';
    });
    if (!on) RQ.restoreRoster();
    var out = document.getElementById('report-output');
    if (out) out.classList.toggle('qn-output', on);
  }

  function _showProgressTab(on) {
    document.getElementById('student-picker').style.display = on ? '' : 'none';
    const tbSave = document.getElementById('tb-save-template');
    if (tbSave) tbSave.style.display = on ? '' : 'none';
    const copySel = document.getElementById('report-copy');
    if (copySel && !on) copySel.style.display = 'none';
    if (on) _syncSidesButtons();
    _syncProgressToolbar();
    const tbRail = document.getElementById('tb-rail-btn');
    if (tbRail) tbRail.style.display = on ? '' : 'none';
    if (!on) phonesView = false;
    _syncPhonesButton();
    const stepper = document.getElementById('report-stepper');
    if (stepper) stepper.style.display = on ? '' : 'none';
    if (!on) _restoreSidebarBadges();
  }

  function _syncPhonesButton() {
    var btn = document.getElementById('tb-phones-btn');
    if (!btn) return;
    btn.style.display = activeTab === 'progress' ? '' : 'none';
    btn.classList.toggle('active', phonesView);
    btn.setAttribute('aria-pressed', phonesView ? 'true' : 'false');
  }

  /* ── Multi-select student picker ─────────────────────────────── */
  var selectedStudentIds = null; // null = all students

  function populateStudentSelect() {
    const students = sortStudents(getStudents(activeCourse), 'lastName');
    const dd = document.getElementById('picker-dropdown');
    let html = '';
    students.forEach(s => {
      const checked = selectedStudentIds === null || selectedStudentIds.includes(s.id);
      html += `<div class="student-picker-item${checked ? ' checked' : ''}" data-sid="${s.id}" data-action="toggleStudentSelection">
      <div class="student-picker-check">${checked ? '✓' : ''}</div>
      <span>${esc(fullName(s))}</span>
    </div>`;
    });
    html += `<div class="student-picker-actions">
    <button class="student-picker-action" data-action="selectAllStudents">Select All</button>
    <button class="student-picker-action" data-action="selectNoneStudents">Deselect All</button>
  </div>`;
    dd.innerHTML = html;
    updatePickerLabel();
  }

  function toggleStudentPicker(e) {
    if (e) e.stopPropagation();
    const dd = document.getElementById('picker-dropdown');
    dd.classList.toggle('open');
  }

  function toggleStudentSelection(sid) {
    const students = getStudents(activeCourse);
    const allIds = students.map(s => s.id);

    if (selectedStudentIds === null) {
      // Was "all" — deselect this one student
      selectedStudentIds = allIds.filter(id => id !== sid);
    } else if (selectedStudentIds.includes(sid)) {
      // Deselect this student
      selectedStudentIds = selectedStudentIds.filter(id => id !== sid);
    } else {
      // Select this student
      selectedStudentIds.push(sid);
    }

    // If all are now selected, go back to null (= all)
    if (selectedStudentIds && selectedStudentIds.length >= allIds.length) {
      selectedStudentIds = null;
    }

    // Update checkmarks without closing dropdown
    const dd = document.getElementById('picker-dropdown');
    dd.querySelectorAll('.student-picker-item').forEach(item => {
      const itemSid = item.dataset.sid;
      const isChecked = selectedStudentIds === null || selectedStudentIds.includes(itemSid);
      item.classList.toggle('checked', isChecked);
      item.querySelector('.student-picker-check').textContent = isChecked ? '✓' : '';
    });

    updatePickerLabel();
    renderReports();
  }

  function selectAllStudents() {
    selectedStudentIds = null;
    const dd = document.getElementById('picker-dropdown');
    dd.querySelectorAll('.student-picker-item').forEach(item => {
      item.classList.add('checked');
      item.querySelector('.student-picker-check').textContent = '✓';
    });
    updatePickerLabel();
    renderReports();
  }

  function selectNoneStudents() {
    selectedStudentIds = [];
    const dd = document.getElementById('picker-dropdown');
    dd.querySelectorAll('.student-picker-item').forEach(item => {
      item.classList.remove('checked');
      item.querySelector('.student-picker-check').textContent = '';
    });
    updatePickerLabel();
    renderReports();
  }

  function updatePickerLabel() {
    const students = getStudents(activeCourse);
    const total = students.length;
    const label = document.getElementById('picker-label');
    if (selectedStudentIds === null) {
      label.textContent = `All Students (${total})`;
    } else if (selectedStudentIds.length === 0) {
      label.textContent = 'No Students Selected';
    } else if (selectedStudentIds.length === 1) {
      const st = students.find(s => s.id === selectedStudentIds[0]);
      label.textContent = st ? fullName(st) : '1 Student';
    } else {
      label.textContent = `${selectedStudentIds.length} of ${total} Students`;
    }
  }

  function _syncLongFormAuthContext() {
    var longForm = _tab().longForm;
    if (longForm) {
      if (typeof setLongFormAuthContext === 'function') {
        setLongFormAuthContext(longForm());
      }
      return;
    }
    if (typeof clearLongFormAuthContext === 'function') {
      clearLongFormAuthContext('term-rating');
    }
  }

  /* ── Main render ─────────────────────────────────────────────── */
  /* A report for Report N shows the grades as of reporting term N's end,
     the year to date (docs/DECISIONS.md, "Reporting periods" 2), when the
     class has that term; otherwise all time. The other pages always show
     the year so far. When the report changes, the roster is drawn again so
     its grades and its "Grades to" note follow the report. */
  function _applyReportTerm() {
    if (typeof setActiveTerm !== 'function') return;
    const cid = activeCourse;
    const before = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;
    const period = (document.getElementById('report-period')?.value || '').match(/Report\s+(\d+)/i);
    const n = period ? Number(period[1]) : null;
    const has =
      n != null &&
      typeof getReportingTerms === 'function' &&
      getReportingTerms(cid).some(function (t) {
        return t.ordinal === n;
      });
    const after = setActiveTerm(cid, has ? n : null);
    const mount = document.getElementById('sidebar-mount');
    if ((before ? before.ordinal : null) !== (after ? after.ordinal : null) && mount && mount.innerHTML) {
      _restoreSidebarBadges();
      mount.innerHTML = renderSidebar(cid, null);
    }
  }

  /* The report picker lists the class's reporting terms. A class on a
     school's preset terms sees that school's report names ("Nov report
     card"); other classes see their own term names; a class with no terms
     keeps Report 1–6. Values stay "Report N" so saved questionnaire data
     (term-N) lines up. Keeps the current choice when it still exists,
     otherwise picks the term that contains today. */
  function populateReportPeriods(keepChoice) {
    const sel = document.getElementById('report-period');
    if (!sel) return;
    const prev = keepChoice ? sel.value : '';
    const terms = typeof getReportingTerms === 'function' ? getReportingTerms(activeCourse) : [];
    const names =
      terms.length && typeof reportingTermReportNames === 'function' ? reportingTermReportNames(terms) : null;
    let opts;
    if (!terms.length) {
      opts = [1, 2, 3, 4, 5, 6].map(function (n) {
        return { n: n, label: 'Report ' + n };
      });
    } else {
      opts = terms.map(function (t, i) {
        let label = t.label || 'Report ' + t.ordinal;
        if (names) label = names[i] || label + ' (no report published)';
        return { n: t.ordinal, label: label };
      });
    }
    sel.innerHTML = opts
      .map(function (o) {
        return '<option value="Report ' + o.n + '">' + esc(o.label) + '</option>';
      })
      .join('');
    const values = opts.map(function (o) {
      return 'Report ' + o.n;
    });
    if (prev && values.indexOf(prev) >= 0) {
      sel.value = prev;
      return;
    }
    const today = typeof courseToday === 'function' ? courseToday(activeCourse) : '';
    let pick = terms.find(function (t) {
      return today && t.starts_on <= today && today <= t.ends_on;
    });
    if (!pick && today)
      pick = terms
        .filter(function (t) {
          return t.starts_on <= today;
        })
        .pop();
    sel.value = pick ? 'Report ' + pick.ordinal : values[0];
  }

  /* The address follows the class, the tab and the open student, so a
     reload or a shared link reopens the same place (Nov 3 sweep: it kept
     the first student and class). */
  function _syncUrl() {
    if (!window.Router || typeof Router.setUrl !== 'function' || !activeCourse) return;
    var url = '/reports?course=' + encodeURIComponent(activeCourse) + '&tab=' + encodeURIComponent(activeTab);
    var t = _tab();
    if (t.address) url += t.address();
    Router.setUrl(url);
  }

  function renderReports() {
    const cid = activeCourse;
    const output = document.getElementById('report-output');
    _applyReportTerm();
    _syncUrl();

    var t = _tab();
    // A tab with no comment box of its own lets go of the last tab's.
    if (!t.longForm) _syncLongFormAuthContext();
    /* Every tab reads returned grades in a class that holds them. Until
       they can be read (ReportScores.ready) the page waits with the
       class's loading line and draws nothing else: Print Reports then has
       nothing to print, and the data layer's redraw once the rows load
       reaches this page through render(). */
    if (!ReportScores.ready(cid)) {
      _waitingForReturns = true;
      _lastSummary = null;
      _lastSummarySet = '';
      // html-safe: ReportScores.WAITING_HTML is fixed markup
      if (output) output.innerHTML = ReportScores.WAITING_HTML;
      return;
    }
    _waitingForReturns = false;
    t.render(cid, output);
  }
  var _waitingForReturns = false; // the page drew the waiting line, not the tab

  function _renderQuestionnaireTab(cid, output) {
    // The sentence bank loads the first time Reports needs it.
    if (typeof COMMENT_BANK === 'undefined') {
      output.innerHTML =
        '<div class="empty-state"><div class="empty-state-text">Loading the sentence bank…</div></div>';
      CommentBank.loadBank().then(function (ok) {
        // The teacher may have left Reports while the bank loaded.
        if (!_mounted || activeTab !== 'questionnaire') return;
        if (ok) renderReports();
        else
          output.innerHTML =
            '<div class="empty-state"><div class="empty-state-text">The sentence bank didn’t load. Check your connection, then open Reports again.</div></div>';
      });
      return;
    }
    output.innerHTML = renderTermQuestionnaire(cid);
    _syncLongFormAuthContext();
    RQ.afterRender();
  }

  function _renderProgressTab(cid, output) {
    // Feedback Pages print Tag Rubrics in the curriculum bank's wording, which
    // loads the first time a class with bank competencies needs it; draw now
    // and again once it is here.
    if (window.RubricPrint && RubricPrint.classUsesBankLevels && RubricPrint.classUsesBankLevels(cid)) {
      RubricPrint.loadBankLevels().then(function (ok) {
        if (ok && _mounted && activeTab !== 'questionnaire' && activeCourse === cid) renderReports();
      });
    }

    // Progress Reports › Sent to Phones: this period's report on the
    // students' phones (teacher/phone-reports.js).
    if (phonesView && typeof PhoneReports !== 'undefined') {
      // html-safe: PhoneReports.panelHtml (phone-reports.js) escapes every value; marked here because student-evidence.js has its own panelHtml
      output.innerHTML = PhoneReports.panelHtml(cid, ReportBlocks.reportContext());
      return;
    }

    // Progress Reports: Page Studio (report-studio.js)
    output.innerHTML = ReportStudio.layoutHtml({ view: studioView, settingsHtml: _printSettingsHtml() });
    if (_isOne()) {
      // The panel and the page listen on these two, made new each time.
      var studio = document.getElementById('studio');
      if (studio) studio.classList.add('studio-one');
      ReportOnePanel.mount(document.getElementById('studio-palette'), _oneApi);
      if (typeof ReportOnePage !== 'undefined') ReportOnePage.mount(document.getElementById('rb-preview'), _oneApi);
    }
    renderStudioPanels();
    renderReportPreview();
    _mountStudioKeys();

    // Highlight selected students in sidebar for progress tab
    if (selectedStudentIds && selectedStudentIds.length > 0) {
      document.querySelectorAll('#gb-sidebar .student-row').forEach(row => {
        const href = row.getAttribute('data-href') || '';
        const match = href.match(/id=([^&]+)/);
        row.classList.toggle('selected', match && selectedStudentIds.includes(match[1]));
      });
    } else {
      document.querySelectorAll('#gb-sidebar .student-row').forEach(row => row.classList.remove('selected'));
    }
  }

  /* ══════════════════════════════════════════════════════════════
   REPORT BUILDER — Interaction functions
   ══════════════════════════════════════════════════════════════ */
  /* The students the canvas shows: everyone selected in Everyone view, one
     of them in One Student view: the one the teacher picked, else the one
     whose report is longest when the class fit first comes in (the teacher
     designs against the fullest report), else the first. The canvas moves
     to the longest once; a later edit never moves it under the teacher. */
  function _previewStudents() {
    var all = sortStudents(getStudents(activeCourse), 'lastName');
    var chosen =
      selectedStudentIds === null
        ? all
        : all.filter(function (st) {
            return selectedStudentIds.includes(st.id);
          });
    // Everyone leads with the students on more than one sheet.
    if (studioView === 'all')
      return ReportStudio.orderBySheets(chosen, _classFitKey === _classFitKeyNow() ? _classFit : null);
    if (previewAuto) {
      var longest = ReportStudio.longestStudent(_classFitKey === _classFitKeyNow() ? _classFit : null);
      if (
        longest &&
        chosen.some(function (st) {
          return st.id === longest;
        })
      ) {
        previewSid = longest;
        previewAuto = false;
      }
    }
    var one = chosen.find(function (st) {
      return st.id === previewSid;
    });
    if (!one) one = chosen[0];
    previewSid = one ? one.id : null;
    return one ? [one] : [];
  }

  function renderReportPreview() {
    if (viewingIssue) {
      _showIssue(viewingIssue.id);
      return;
    }
    // A render with nothing to print ("No report data yet", no students) leaves no summary behind:
    // Print Reports must not open on the last render's students.
    _lastSummary = null;
    _lastSummarySet = '';
    Preview.renderReportPreview({
      cid: activeCourse,
      students: _previewStudents(),
      reportConfig: reportConfig,
      paper: reportPaper,
      layout: _layout(),
      onSheets: _rememberSummary,
    });
    _syncPrintButton();
    var preview = document.getElementById('rb-preview');
    if (preview) {
      preview.classList.toggle('report-fitmap', studioView === 'all');
      preview.classList.toggle('studio-all', studioView === 'all');
      _applyStudioZoom(preview);
      _decoratePages(preview);
      _applySelection(preview);
    }
  }

  /* One student's pages scale to the canvas: two side by side when there
     is room, else one above the other. Everyone keeps the Fit Map's scale. */
  function _applyStudioZoom(preview) {
    if (studioView === 'all') {
      preview.classList.remove('studio-stacked');
      return;
    }
    var z = _isOne()
      ? _oneZoom(preview.clientWidth || 800)
      : ReportStudio.fitZoom(preview.clientWidth || 800, reportPaper);
    preview.style.setProperty('--sheet-zoom', String(z.zoom));
    preview.classList.toggle('studio-stacked', !!z.stacked);
  }

  /* One Report's pages are worked on directly (a row left off, a heading
     renamed, the comment edited), so they are drawn at reading size: one
     above the other at up to full size, or two side by side where the
     canvas is wide enough for both at three quarters or more. */
  function _oneZoom(canvasWidth) {
    var sheetW = 8.5 * 96;
    // The canvas pads 24px a side; two pages sit 22px apart.
    var two = (canvasWidth - 48 - 22) / (2 * sheetW);
    if (two >= 0.75) return { zoom: Math.round(Math.min(1, two) * 1000) / 1000, stacked: false };
    var one = Math.min(1, Math.max(0.5, (canvasWidth - 48) / sheetW));
    return { zoom: Math.round(one * 1000) / 1000, stacked: true };
  }

  /* + Page after the last side; Empty · Remove on an empty side past the
     second. One Student view of Build Your Own only. */
  function _decoratePages(preview) {
    if (_isOne()) {
      if (!viewingIssue && typeof ReportOnePage !== 'undefined') ReportOnePage.decorate(preview, _oneApi());
      return;
    }
    if (studioView !== 'one' || viewingIssue || _isGrade()) return;
    var student = preview.querySelector('.sheet-student');
    if (!student) return;
    var f = _formOf();
    f.sides.forEach(function (sd, i) {
      if (i < 2 || sd.rows.length) return;
      var sheet = preview.querySelector('.sheet-zoom[data-side="' + i + '"] .report-sheet');
      if (!sheet) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'studio-page-empty no-print';
      b.dataset.action = 'studioRemoveSide';
      b.dataset.side = String(i);
      b.textContent = 'Empty · Remove';
      sheet.appendChild(b);
    });
    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'studio-page-add no-print';
    add.dataset.action = 'studioAddSide';
    add.textContent = '+ Page';
    student.appendChild(add);
  }

  /* The selected block: a blue outline on the page and its inspector
     pinned at the top right of the canvas, over the gutter the pages leave
     (ReportStudio.GUTTER_W), so it stays put as the pages scroll. A control
     that had focus in the inspector has it again after a redraw. */
  function _applySelection(preview) {
    var canvas = preview.parentElement;
    var oldBar = canvas && canvas.querySelector('.studio-bar');
    var had = oldBar && oldBar.contains(document.activeElement) ? document.activeElement : null;
    var focusKey = had
      ? ['action', 'key', 'value', 'dir', 'size', 'side', 'rule']
          .map(function (k) {
            return had.dataset[k] ? '[data-' + k + '="' + had.dataset[k] + '"]' : '';
          })
          .join('')
      : '';
    preview.querySelectorAll('.sheet-cell.studio-sel').forEach(function (el) {
      el.classList.remove('studio-sel');
    });
    if (oldBar) oldBar.remove();
    preview.querySelectorAll('.sheet-body .sheet-cell[data-block]').forEach(function (el) {
      // Every block, the letterhead too, can be reached and selected from
      // the keyboard; a screen reader hears the block's name.
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'group');
      el.setAttribute('aria-label', _label(el.dataset.block));
    });
    if (_focusBlock) {
      var target = preview.querySelector('.sheet-body .sheet-cell[data-block="' + _focusBlock + '"]');
      _focusBlock = null;
      if (target) target.focus({ preventScroll: true });
    }
    if (!studioSelected || studioView !== 'one' || viewingIssue || !canvas) return;
    var cells = preview.querySelectorAll('.sheet-body .sheet-cell[data-block="' + studioSelected + '"]');
    if (!cells.length) return;
    cells.forEach(function (el) {
      el.classList.add('studio-sel');
    });
    var st = _previewStudent();
    var who = st ? { id: st.id, name: fullName(st) } : null;
    var bar = document.createElement('div');
    bar.innerHTML = ReportStudio.blockToolbarHtml(
      _formOf(),
      studioSelected,
      who,
      ReportBlocks.showDefaults(activeCourse),
    );
    var barEl = bar.firstElementChild;
    if (!barEl) return;
    var top = preview.offsetTop + 12;
    barEl.style.top = top + 'px';
    barEl.style.maxHeight = 'calc(100% - ' + (top + 12) + 'px)';
    canvas.appendChild(barEl);
    if (focusKey) {
      var again = barEl.querySelector(focusKey);
      if (again) again.focus({ preventScroll: true });
    }
  }
  var _focusBlock = null;

  /* ── The rail: sheets per student ──────────────────────────────
     On the Report Card, each sidebar row shows how many sheets the
     student needs ("1 sheet", "2 sheets") or "No comment", with the reason
     as its title. The grade badges come back on any other tab or preset. */
  var _sidebarAnnotated = false;
  function _annotateSidebar(summary) {
    if (!summary || !summary.perStudent) return;
    document.querySelectorAll('#gb-sidebar .student-row[data-sid]').forEach(function (row) {
      var cell = row.querySelector('.student-row-grades');
      var info = cell && summary.perStudent[row.getAttribute('data-sid')];
      if (!info) return;
      if (cell.dataset.gradesHtml === undefined) cell.dataset.gradesHtml = cell.innerHTML;
      if (info.sheets <= 1 && !info.noComment) {
        // html-safe: the cell's own earlier innerHTML, saved in its dataset just above
        cell.innerHTML = cell.dataset.gradesHtml;
        return;
      }
      var cls = info.sheets > 1 ? 'over' : 'none';
      cell.innerHTML =
        '<span class="student-row-sheets ' +
        cls +
        '"' +
        (info.reason ? ' title="' + esc(info.reason) + '"' : '') +
        '>' +
        esc(info.badge) +
        '</span>';
    });
    _sidebarAnnotated = true;
  }
  function _restoreSidebarBadges() {
    if (!_sidebarAnnotated) return;
    document.querySelectorAll('#gb-sidebar .student-row-grades').forEach(function (cell) {
      if (cell.dataset.gradesHtml !== undefined) {
        // html-safe: the cell's own earlier innerHTML, saved by _annotateSidebar
        cell.innerHTML = cell.dataset.gradesHtml;
        delete cell.dataset.gradesHtml;
      }
    });
    _sidebarAnnotated = false;
  }

  /* ── Issued copies ───────────────────────────────────────────────
     Issue saves a fixed copy of every report (report-issues.js), then
     prints. The toolbar's copy picker shows the term's issues; choosing
     one shows and prints that copy instead of the live reports. */
  var _lastSummary = null;
  var _lastSummarySet = ''; // the set of scores the summary was drawn from
  var viewingIssue = null; // the loaded copy while one is shown

  function _rememberSummary(summary) {
    _lastSummary = summary;
    _lastSummarySet = _reportSet();
    _annotateSidebar(summary);
    _populateCopies();
    if (studioView === 'all') {
      _classFit = summary;
      _classFitKey = _classFitKeyNow();
      _renderFitLine();
      _leadWithLongest(summary);
    } else {
      _scheduleClassFit();
    }
  }

  /* Everyone, once its own render has measured the class: the students
     on more than one sheet move to the front, in place, without a redraw. */
  function _leadWithLongest(summary) {
    var preview = document.getElementById('rb-preview');
    if (!preview || !summary || !summary.perStudent) return;
    var nodes = Array.prototype.slice.call(preview.querySelectorAll(':scope > .sheet-student'));
    var wanted = ReportStudio.orderBySheets(
      nodes.map(function (el) {
        return { id: el.dataset.sid };
      }),
      summary,
    ).map(function (x) {
      return x.id;
    });
    var current = nodes.map(function (el) {
      return el.dataset.sid;
    });
    if (wanted.join() === current.join()) return;
    wanted.forEach(function (sid) {
      var el = nodes.find(function (n) {
        return n.dataset.sid === sid;
      });
      if (el) preview.appendChild(el);
    });
  }

  function _populateCopies() {
    var sel = document.getElementById('report-copy');
    if (!sel) return;
    var sheets = activeTab === 'progress';
    var ctx = ReportBlocks.reportContext();
    var issues = sheets && typeof ReportIssues !== 'undefined' ? ReportIssues.list(activeCourse, ctx.termId) : [];
    if (!issues.length) {
      sel.style.display = 'none';
      sel.innerHTML = '';
      return;
    }
    var current = viewingIssue ? viewingIssue.id : '';
    sel.innerHTML =
      '<option value="">Live</option>' +
      issues
        .map(function (e) {
          return '<option value="' + esc(e.id) + '">' + esc(ReportIssues.label(e)) + '</option>';
        })
        .join('');
    sel.value = current;
    sel.style.display = '';
  }

  function _showIssue(id) {
    var preview = document.getElementById('rb-preview');
    if (!id || !preview) {
      viewingIssue = null;
      renderReports();
      return;
    }
    ReportIssues.load(id, activeCourse).then(function (rec) {
      if (!_mounted) return;
      if (!rec) {
        viewingIssue = null;
        renderReports();
        return;
      }
      viewingIssue = rec;
      _paintIssue(rec, preview);
    });
  }

  /* A loaded copy on the canvas: every student in it in Everyone view, one
     in One Student view. */
  function _paintIssue(rec, preview) {
    var shown = rec.students;
    if (studioView !== 'all') {
      var one = rec.students.find(function (st) {
        return st.sid === previewSid;
      });
      shown = one ? [one] : rec.students.slice(0, 1);
    }
    // html-safe: an issued copy's HTML, saved at Issue from the sheet engine's own render (ReportSheets/GradeReport layoutStudent over ReportBlocks)
    preview.innerHTML = shown
      .map(function (st) {
        return st.html;
      })
      .join('');
    preview.classList.add('report-sheets-on');
    preview.classList.toggle('report-fitmap', studioView === 'all');
    preview.classList.toggle('studio-all', studioView === 'all');
    ReportSheets.setPageStyle(rec.paper || 'letter');
    _applyStudioZoom(preview);
    _syncPrintButton();
  }

  /* Print This Copy prints the whole copy, every student in it, whatever
     the canvas shows: like _printNow, the canvas shows Everyone for the
     print and goes back afterwards. */
  function _printIssue() {
    var rec = viewingIssue;
    var preview = document.getElementById('rb-preview');
    if (!rec || !preview) return;
    var wasOne = studioView === 'one';
    if (wasOne) {
      studioView = 'all';
      _paintIssue(rec, preview);
    }
    var restore = function () {
      window.removeEventListener('afterprint', restore);
      if (!wasOne) return;
      wasOne = false;
      studioView = 'one';
      if (viewingIssue === rec) _paintIssue(rec, preview);
    };
    window.addEventListener('afterprint', restore);
    window.print();
    setTimeout(restore, 0);
  }

  function _syncPrintButton() {
    var btn = document.getElementById('tb-print-btn');
    if (!btn) return;
    btn.textContent = viewingIssue ? 'Print This Copy' : 'Print Reports';
  }

  /* Printing takes every selected student, whatever the canvas shows: the
     canvas switches to Everyone for the print and back afterwards. */
  function _printNow() {
    ensureClassFresh(activeCourse).then(function (fresh) {
      if (!_mounted) return;
      if (!(fresh || window.confirm("Couldn't confirm this class is up to date. Print the saved copy anyway?"))) return;
      var wasOne = studioView === 'one' || _restoreOneAfterPrint;
      _restoreOneAfterPrint = false;
      if (studioView === 'one') {
        studioView = 'all';
        renderReports();
      }
      var restore = function () {
        window.removeEventListener('afterprint', restore);
        if (wasOne) {
          studioView = 'one';
          renderReports();
        }
      };
      window.addEventListener('afterprint', restore);
      window.print();
      // print() blocks until the dialog closes; a browser that never fires
      // afterprint (headless WebKit) still gets One Student back.
      setTimeout(restore, 0);
    });
  }

  /* ── The Issue dialog ──────────────────────────────────────────── */
  var ISSUE_OVERLAY_ID = 'issue-overlay';
  var _issueState = null;

  function _issueCounts() {
    // A summary drawn from another set of scores is not what would print now.
    var s = (_lastSummarySet === _reportSet() && _lastSummary) || {
      perStudent: {},
      continued: [],
      noComment: [],
      noAttendance: [],
    };
    var ids = Object.keys(s.perStudent || {});
    var sheets = 0;
    var hashes = {};
    ids.forEach(function (sid) {
      sheets += s.perStudent[sid].sheets;
      hashes[sid] = ReportIssues.hash(s.perStudent[sid].html);
    });
    var ctx = ReportBlocks.reportContext();
    var last = ReportIssues.latest(activeCourse, ctx.termId);
    // Each student against their own last printed copy, not only the newest.
    var changed = last
      ? ReportIssues.changedSince({ hashes: ReportIssues.printedHashes(activeCourse, ctx.termId) }, hashes)
      : ids;
    return { ids: ids, sheets: sheets, hashes: hashes, last: last, changed: changed, ctx: ctx, summary: s };
  }

  // html-safe: term, course, form name, issue label and student names esc()'d; counts are numbers; the rest is fixed markup
  function _printDialogHtml(c) {
    var course = COURSES[activeCourse] || {};
    var n = c.ids.length;
    var subtitle = [
      c.ctx.termLabel,
      course.name,
      typeof courseBlockLabel === 'function' ? courseBlockLabel(course) : '',
    ]
      .filter(Boolean)
      .map(esc)
      .join(' \u00B7 ');
    // Students grouped by sheets: "24 on 1 sheet, 3 on 2, 1 on 3".
    var bySheets = {};
    c.ids.forEach(function (sid) {
      var k = c.summary.perStudent[sid].sheets;
      bySheets[k] = (bySheets[k] || 0) + 1;
    });
    var counts = Object.keys(bySheets)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      });
    var studentsLine =
      n +
      (n === 1 ? ' student' : ' students') +
      ' \u00B7 ' +
      (counts.length > 1
        ? counts
            .map(function (k) {
              return bySheets[k] + ' on ' + k + (k === 1 ? ' sheet' : '');
            })
            .join(', ')
        : counts[0] > 1
          ? counts[0] + ' sheets' + (n === 1 ? '' : ' each')
          : n === 1
            ? '1 sheet'
            : '1 sheet each');
    var form = ReportSheets.formFor(reportConfig);
    var grade = _isGrade();
    var html = '<div class="confirm-card issue-card">';
    html += '<div class="confirm-title" id="issue-title">Print ' + n + (n === 1 ? ' Report' : ' Reports') + '</div>';
    html += '<div class="confirm-message">' + subtitle + '</div>';
    html += '<div class="issue-kv">';
    html +=
      '<span class="issue-k">' +
      (_isOne() ? 'Setup' : 'Form') +
      '</span><span>' +
      esc(_isOne() ? _oneSetupName() : grade ? 'Quick Report' : form.name) +
      ' \u00B7 ' +
      (reportPaper === 'legal' ? 'Legal' : 'Letter') +
      ' \u00B7 ' +
      'Black' +
      '</span>';
    html += '<span class="issue-k">Sheets</span><span>' + studentsLine + '</span>';
    html +=
      '<span class="issue-k">Copier</span><span>' +
      (reportPaper === 'legal' ? 'Legal' : 'Letter') +
      ', 2-sided, flip on long edge</span>';
    html += '</div>';
    html += '<fieldset class="issue-group"><legend>Which Students</legend>';
    html +=
      '<label class="issue-option"><input type="radio" name="issue-who" value="all" checked><span>All ' +
      n +
      '</span></label>';
    if (c.last) {
      html +=
        '<label class="issue-option"><input type="radio" name="issue-who" value="changed"' +
        (c.changed.length ? '' : ' disabled') +
        '><span>Changed since the last print <span class="issue-help">(' +
        esc(ReportIssues.label(c.last).replace(/^Printed /, '')) +
        ' \u00B7 ' +
        c.changed.length +
        (c.changed.length === 1 ? ' student' : ' students') +
        ')</span></span></label>';
    }
    html += '</fieldset>';
    // The Letterhead's Name option, here too so it can be set at print time.
    var nameStyle = _isOne()
      ? (_oneModel().options.header || {}).name
      : grade
        ? _gradeOpts().name
        : ReportSheets.optionsFor(ReportSheets.cellOf(form, 'header') || { block: 'header' }).name;
    html += '<fieldset class="issue-group"><legend>Name</legend>';
    html +=
      '<label class="issue-option"><input type="radio" name="issue-name" value="preferred"' +
      (nameStyle !== 'first' ? ' checked' : '') +
      '><span>Preferred Name <span class="issue-help">(first name if none)</span></span></label>';
    html +=
      '<label class="issue-option"><input type="radio" name="issue-name" value="first"' +
      (nameStyle === 'first' ? ' checked' : '') +
      '><span>First Name</span></label>';
    html += '<div class="issue-help">The last name always follows.</div>';
    html += '</fieldset>';
    var warn = [];
    if (c.summary.noComment.length) {
      warn.push(
        esc(c.summary.noComment.join(', ')) +
          (c.summary.noComment.length === 1 ? ' has' : ' have') +
          ' no Teacher Comment. The box prints with lines. <button type="button" data-issue="write">Write them now</button>',
      );
    }
    // Attendance is optional: a student without totals prints without the
    // block, and the dialog says so once, like a missing comment.
    var noAtt = c.summary.noAttendance || [];
    if (noAtt.length) {
      warn.push(
        (noAtt.length === c.ids.length
          ? 'No attendance is entered for this report.'
          : esc(noAtt.join(', ')) + (noAtt.length === 1 ? ' has' : ' have') + ' no attendance entered.') +
          ' Their reports print without it. <button type="button" data-issue="attendance">Enter it now</button>',
      );
    }
    if (grade) {
      // The Quick Report names each cause on its own: a student can have both.
      var named = function (key) {
        return Object.keys(c.summary.perStudent || {})
          .filter(function (sid) {
            return c.summary.perStudent[sid][key];
          })
          .map(function (sid) {
            return c.summary.perStudent[sid].name;
          });
      };
      var cut = named('gradeOver');
      var tall = named('feedbackOver');
      if (cut.length) warn.push(esc(cut.join(', ')) + ': too many assessments to fit on one sheet.');
      if (tall.length) warn.push(esc(tall.join(', ')) + ': a feedback card is taller than a page.');
    } else if (c.summary.over && c.summary.over.length) {
      warn.push(esc(c.summary.over.join(', ')) + ': a block is taller than a page.');
    }
    if (warn.length) {
      html +=
        '<div class="issue-warn"><b>Before you print</b>' +
        warn
          .map(function (w) {
            return '<div>' + w + '</div>';
          })
          .join('') +
        '</div>';
    }
    html +=
      '<div class="confirm-actions"><button type="button" class="confirm-cancel" data-issue="cancel">Cancel</button>';
    html += '<button type="button" class="confirm-ok primary" data-issue="go">Print</button></div>';
    html += '</div>';
    return html;
  }

  /* The dialog and the copy take every selected student, so the canvas
     shows Everyone while it is open; Cancel puts One Student back. */
  var _restoreOneAfterPrint = false;
  function openIssueDialog() {
    closeIssueDialog();
    if (studioView === 'one') {
      studioView = 'all';
      _restoreOneAfterPrint = true;
      renderReports();
    }
    if (!_lastSummary || !Object.keys(_lastSummary.perStudent || {}).length) return;
    var c = _issueCounts();
    // The Name choice redraws the reports while the dialog is open; Cancel
    // and Escape put back what the class had (step 4 group 2 #6).
    _issueState = {
      counts: c,
      trigger: document.activeElement,
      nameChanged: false,
      gradeBefore: reportConfig.gradeReport ? JSON.parse(JSON.stringify(reportConfig.gradeReport)) : null,
      formBefore: reportConfig.form ? JSON.parse(JSON.stringify(reportConfig.form)) : null,
      oneBefore: reportConfig.one ? JSON.parse(JSON.stringify(reportConfig.one)) : null,
    };
    var overlay = document.createElement('div');
    overlay.id = ISSUE_OVERLAY_ID;
    overlay.className = 'confirm-overlay issue-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'issue-title');
    overlay.innerHTML = _printDialogHtml(c);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        closeIssueDialog();
        return;
      }
      var a = e.target.closest ? e.target.closest('[data-issue]') : null;
      if (!a) return;
      e.preventDefault();
      if (a.dataset.issue === 'cancel') closeIssueDialog();
      else if (a.dataset.issue === 'go') _issueFromDialog(overlay);
      else if (a.dataset.issue === 'write' || a.dataset.issue === 'attendance') {
        var key = a.dataset.issue === 'write' ? 'noComment' : 'noAttendance';
        var first = Object.keys(c.summary.perStudent).find(function (sid) {
          return c.summary.perStudent[sid][key];
        });
        closeIssueDialog();
        if (first) {
          tqSelectStudent(first);
          switchTab('questionnaire');
        }
      }
    });
    // Name: change the Letterhead option, redraw the reports, and print
    // what is now on screen.
    overlay.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || t.name !== 'issue-name') return;
      if (_isOne())
        _setOne(ReportOne.setOption(_oneModel(), 'header', 'name', t.value === 'first' ? 'first' : 'preferred'));
      else if (_isGrade()) _setGradeOption('name', t.value === 'first' ? 'first' : 'preferred');
      else _setForm(ReportSheets.setOption(_formOf(), 'header', 'name', t.value));
      if (_issueState) {
        _issueState.nameChanged = true;
        _issueState.counts = _issueCounts();
      }
    });
    _issueState.keyHandler = function (e) {
      if (e.key === 'Escape') closeIssueDialog();
      // Tab and Shift-Tab stay inside the dialog, which is modal (step 4
      // group 3 #64).
      else if (e.key === 'Tab') _trapTab(e, overlay);
    };
    document.addEventListener('keydown', _issueState.keyHandler);
    document.body.appendChild(overlay);
    var first = overlay.querySelector('input');
    if (first && first.focus) first.focus();
  }

  /* Keeps Tab inside a modal dialog: past its last control it goes to the
     first, before its first to the last. */
  function _trapTab(e, box) {
    var items = Array.prototype.slice
      .call(
        box.querySelectorAll(
          'button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex="0"]',
        ),
      )
      .filter(function (x) {
        // A radio group is one stop: its checked radio.
        return !x.hidden && x.offsetParent !== null && (x.type !== 'radio' || x.checked);
      });
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    var at = document.activeElement;
    if (!box.contains(at)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && at === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /* keepEveryone: the dialog closes to print, so the canvas stays on
     Everyone and the Name chosen in it stays. Any other close is a cancel. */
  function closeIssueDialog(keepEveryone) {
    DraftsBeforePrint.close();
    var overlay = document.getElementById(ISSUE_OVERLAY_ID);
    if (overlay && overlay.remove) overlay.remove();
    if (_issueState && _issueState.nameChanged && !keepEveryone) {
      _issueState.nameChanged = false;
      if (_isOne()) {
        if (_issueState.oneBefore) reportConfig.one = _issueState.oneBefore;
        else delete reportConfig.one;
        _saveReportConfig();
        _classFitKey = '';
        renderStudioPanels();
        renderReportPreview();
      } else if (_isGrade()) {
        reportConfig.gradeReport = _issueState.gradeBefore;
        _saveReportConfig();
        _classFitKey = '';
        renderStudioPanels();
        renderReportPreview();
      } else {
        _setForm(_issueState.formBefore || ReportSheets.formFor(null));
      }
    }
    if (_restoreOneAfterPrint && !keepEveryone) {
      _restoreOneAfterPrint = false;
      studioView = 'one';
      renderReports();
    }
    if (_issueState) {
      if (_issueState.keyHandler) document.removeEventListener('keydown', _issueState.keyHandler);
      var trigger = _issueState.trigger;
      _issueState = null;
      try {
        if (trigger && typeof trigger.focus === 'function') trigger.focus();
      } catch (e) {
        /* the button may be gone */
      }
    }
  }

  /* The drafts a print of these students would leave out, on the work the
     report counts (the year to date as of the report's term), or null
     when the class does not hold grades or none is a draft
     (teacher/drafts-before-print.js). */
  function _draftsInPrint(ids) {
    var cid = activeCourse;
    if (!DraftsBeforePrint.holds(cid)) return null;
    var aids = (getAssessments(cid) || [])
      .filter(function (a) {
        return assessmentInYearToDate(cid, a);
      })
      .map(function (a) {
        return a.id;
      });
    return DraftsBeforePrint.find(cid, aids, ids);
  }

  /* Print in the dialog. In a class that holds grades, when a student in
     the print has a draft the report would show, it asks first (S2-F1):
     Return Them, Then Print returns exactly those drafts and prints with
     them in; Print Without Them prints the returned grades; Cancel goes
     back to the dialog and does nothing. */
  function _issueFromDialog(overlay) {
    var c = _issueState && _issueState.counts;
    if (!c) return;
    var who = (overlay.querySelector('input[name="issue-who"]:checked') || {}).value || 'all';
    var found = _draftsInPrint(who === 'changed' ? c.changed : c.ids);
    if (!found) return _issueAndPrint(c, who);
    // The question belongs to this Print dialog, for this class and this report.
    var owner = {
      el: overlay,
      still: function () {
        return _issueState !== null && _issueState.counts === c && activeCourse === found.cid;
      },
    };
    DraftsBeforePrint.ask(
      found,
      'reports',
      function (choice) {
        if (choice === 'cancel') return;
        if (choice === 'return') {
          // Every draft it named is returned, or nothing prints and no copy is saved.
          if (!DraftsBeforePrint.returnAll(found).all) {
            // Some may have returned: what Print Without Them prints is drawn again from them.
            renderReportPreview();
            if (_issueState) {
              var again = _issueCounts();
              if (who === 'changed') again.changed = c.changed;
              _issueState.counts = again;
            }
            DraftsBeforePrint.showFailed(overlay);
            return;
          }
          // Drawn again from the grades now returned, so what prints and the copy kept hold them.
          renderReportPreview();
          var now = _issueCounts();
          if (who === 'changed') now.changed = c.changed;
          c = now;
        }
        _issueAndPrint(c, who);
      },
      owner,
    );
  }

  function _issueAndPrint(c, who) {
    var doPrint = true;
    closeIssueDialog(true);
    var ids = who === 'changed' ? c.changed : c.ids;
    if (who === 'changed') {
      // Show and print only what changed; the copy keeps every student issued.
      selectedStudentIds = ids.slice();
      populateStudentSelect();
      renderReportPreview();
    }
    var students = ids.map(function (sid) {
      var p = c.summary.perStudent[sid];
      return { sid: sid, name: p.name, sheets: p.sheets, html: p.html };
    });
    ReportIssues.issue({
      cid: activeCourse,
      termId: c.ctx.termId,
      termLabel: c.ctx.termLabel,
      paper: reportPaper,
      form: _isOne() ? { one: _oneModel() } : ReportSheets.normalizeForm(reportConfig.form),
      students: students,
    }).then(function (res) {
      if (!_mounted) return;
      _populateCopies();
      if (res && res.entry) {
        var sel = document.getElementById('report-copy');
        if (sel && sel.querySelector('option[value="' + res.entry.id + '"]')) sel.value = '';
      }
      if (doPrint) _printNow();
    });
  }

  /* ── Page Studio state (report-studio.js) ─────────────────────── */
  var studioView = 'one'; // 'one' | 'all'
  var previewSid = null; // the student on the canvas in One Student view
  var previewAuto = true; // previewSid was chosen for the teacher (the longest report), not by them
  var studioSelected = null; // the selected block id
  var studioTab = 'blocks'; // the palette's tab
  var _blockSizes = null; // every block's Row and Side by Side height for the class, measured once per class/paper/type
  var _blockSizesSet = ''; // and per set of scores: the set those heights were measured in

  /* Every edit saves the form and can be undone: `label` names the change
     on the Undo toast ("Moved Teacher Comment up"); without one there is
     no toast (an Undo itself, or a change the caller announces). */
  function _setForm(form, label) {
    var before = reportConfig.form ? JSON.parse(JSON.stringify(reportConfig.form)) : null;
    reportConfig.form = ReportSheets.normalizeForm(form);
    // Heights follow each placed block's options and lines; a move or a
    // size change keeps them.
    if (before && _optionsOf(before) !== _optionsOf(reportConfig.form)) _blockSizes = null;
    _saveReportConfig();
    if (studioSelected && !ReportSheets.locate(reportConfig.form, studioSelected)) studioSelected = null;
    _classFitKey = '';
    renderStudioPanels();
    renderReportPreview();
    _syncSidesButtons();
    if (label && typeof showUndoToast === 'function') {
      var wasSelected = studioSelected;
      var cid = activeCourse;
      showUndoToast(label, function () {
        // Undo belongs to the class it was made in.
        if (activeCourse !== cid) return;
        studioSelected = wasSelected;
        _setForm(before || ReportSheets.formFor(null));
      });
    }
  }

  /* Every placed block's options, no-evidence rule and lines, by id. */
  function _optionsOf(f) {
    var out = {};
    (f.sides || []).forEach(function (sd) {
      sd.rows.forEach(function (row) {
        row.cells.forEach(function (c) {
          out[c.block] = [c.options || null, c.noEvidence || null, c.lines || null];
        });
      });
    });
    return JSON.stringify(out);
  }

  function _formOf() {
    return ReportSheets.formFor(reportConfig);
  }

  /* ── Grade Report (grade-report.js) ──────────────────────────── */
  function _isGrade() {
    return !_isOne() && !!reportConfig && reportConfig.progressMode === 'grade';
  }

  /* ── One Report (report-one.js) ───────────────────────────────
     One list of parts in place of the Quick Report and Custom (Colin,
     2026-11-12; docs/plans/one-report-build-plan.md). Behind a switch
     until it is the Progress Reports screen for everyone: ?onereport=1 in
     the address turns it on for this device, ?onereport=0 off. The class's
     Quick Report choices and built form are read, never rewritten; the
     model is saved as reportConfig.one the first time the teacher changes
     something. */
  var ONE_KEY = 'fv-one-report';
  var _oneOn = null;
  var _oneForStudent = false; // Changes Apply To: the student on the canvas, not the class
  function _isOne() {
    if (_oneOn === null) {
      var on = false;
      try {
        var q = /[?&]onereport=([01])/.exec(location.search);
        if (q) {
          if (q[1] === '1') localStorage.setItem(ONE_KEY, '1');
          else localStorage.removeItem(ONE_KEY);
        }
        on = localStorage.getItem(ONE_KEY) === '1';
      } catch (e) {
        on = false;
      }
      _oneOn = on && typeof ReportOne !== 'undefined' && typeof ReportOnePanel !== 'undefined';
    }
    return _oneOn && !!reportConfig;
  }
  var _oneCache = { rc: null, one: null, model: null };
  function _oneModel() {
    // Worked out again only when the class's settings or its saved model change.
    if (_oneCache.rc !== reportConfig || _oneCache.one !== reportConfig.one) {
      _oneCache = { rc: reportConfig, one: reportConfig.one, model: ReportOne.modelFor(reportConfig) };
    }
    return _oneCache.model;
  }
  /* The Setup the class's report matches, by name; Your Setup once the
     teacher has changed its parts. */
  function _oneSetupName() {
    var id = _oneModel().setup;
    var s = ReportOne.SETUPS.filter(function (x) {
      return x.id === id;
    })[0];
    return s ? s.name : 'Your Setup';
  }
  /* Every change saves the model and can be undone, as _setForm does. */
  function _setOne(model, label) {
    var before = reportConfig.one ? JSON.parse(JSON.stringify(reportConfig.one)) : null;
    reportConfig.one = ReportOne.normalize(model);
    _saveReportConfig();
    _classFitKey = '';
    renderStudioPanels();
    renderReportPreview();
    if (label && typeof showUndoToast === 'function') {
      var cid = activeCourse;
      showUndoToast(label, function () {
        if (activeCourse !== cid) return;
        if (before) reportConfig.one = before;
        else delete reportConfig.one;
        _saveReportConfig();
        _classFitKey = '';
        renderStudioPanels();
        renderReportPreview();
      });
    }
  }
  /* What the panel (report-one-panel.js) and the page (report-one-page.js)
     are given to read and change the report with. */
  function _oneApi() {
    return {
      cid: activeCourse,
      model: _oneModel,
      set: _setOne,
      student: _previewStudent,
      students: function () {
        return sortStudents(getStudents(activeCourse), 'lastName');
      },
      // The student a change is kept for, or null when it is the class's.
      scope: function () {
        var st = _oneForStudent && studioView === 'one' ? _previewStudent() : null;
        return st ? st.id : null;
      },
      setScope: function (forStudent) {
        _oneForStudent = !!forStudent;
        renderStudioPanels();
        renderReportPreview();
      },
      goStudent: function (sid) {
        previewSid = sid;
        previewAuto = false;
        studioView = 'one';
        renderReports();
      },
      view: function () {
        return studioView;
      },
      ctx: function () {
        return ReportBlocks.reportContext();
      },
      paper: function () {
        return reportPaper;
      },
      // The whole class laid out (sheets per student), once it is measured.
      fit: function () {
        return _classFitKey === _classFitKeyNow() ? _classFit : null;
      },
      redraw: function () {
        _classFitKey = '';
        renderStudioPanels();
        renderReportPreview();
      },
      announce: _announce,
    };
  }
  function _gradeOpts() {
    return GradeReport.options(reportConfig && reportConfig.gradeReport);
  }
  // The layout the preview, the fit line and printing use: the Grade
  // Report's, or the built form's (undefined).
  function _layout() {
    if (_isOne()) return ReportOne.layoutWith(_oneModel());
    return _isGrade() ? GradeReport.layoutWith(_gradeOpts()) : undefined;
  }
  function _setProgressMode(mode) {
    if (mode !== 'grade' && mode !== 'build') return;
    if (reportConfig.progressMode === mode) return;
    reportConfig.progressMode = mode;
    _saveReportConfig();
    studioSelected = null;
    _classFitKey = '';
    previewAuto = true;
    renderReports();
    _syncProgressToolbar();
  }
  function _setGradeOption(key, value) {
    reportConfig.gradeReport = Object.assign({}, _gradeOpts());
    reportConfig.gradeReport[key] = value;
    _saveReportConfig();
    _classFitKey = '';
    renderStudioPanels();
    renderReportPreview();
  }
  /* Save as Template belongs to Build Your Own (so does Sides:
     _printSettingsHtml). */
  function _syncProgressToolbar() {
    var build = activeTab === 'progress' && !_isGrade() && !_isOne();
    var save = document.getElementById('tb-save-template');
    if (save) save.style.display = build ? '' : 'none';
    var rail = document.getElementById('tb-rail-btn');
    if (rail) rail.textContent = _isOne() ? 'Parts' : _isGrade() ? 'Options' : 'Blocks';
  }
  /* Paper, and for Build Your Own Sides, over the canvas beside
     One Student and Everyone. */
  // html-safe: literal labels, ids and option values only
  function _printSettingsHtml() {
    var seg = function (label, id, action, key, options, current) {
      return (
        '<span class="tb-label">' +
        label +
        '</span><div class="seg seg-sm" id="' +
        id +
        '" role="radiogroup" aria-label="' +
        label +
        '">' +
        options
          .map(function (o) {
            var on = o[0] === current;
            return (
              '<button type="button" class="seg-btn' +
              (on ? ' active' : '') +
              '" data-action="' +
              action +
              '" data-' +
              key +
              '="' +
              o[0] +
              '" role="radio" aria-checked="' +
              on +
              '">' +
              o[1] +
              '</button>'
            );
          })
          .join('') +
        '</div>'
      );
    };
    var html = seg(
      'Paper',
      'report-paper',
      'setPaper',
      'paper',
      [
        ['letter', 'Letter'],
        ['legal', 'Legal'],
      ],
      reportPaper,
    );
    if (!_isGrade() && !_isOne()) {
      html += seg(
        'Sides',
        'report-sides',
        'setSides',
        'sides',
        [
          ['1', 'Front Only'],
          ['2', 'Front and Back'],
        ],
        _formOf().sides.length > 1 ? '2' : '1',
      );
    }
    return html + '<span class="tb-divider" aria-hidden="true">\u2502</span>';
  }
  // html-safe: literal labels and modes only
  function _modeSwitchHtml() {
    var grade = _isGrade();
    var btn = function (mode, label, on) {
      return (
        '<button type="button" class="seg-btn' +
        (on ? ' active' : '') +
        '" data-action="progressMode" data-mode="' +
        mode +
        '" role="radio" aria-checked="' +
        on +
        '">' +
        label +
        '</button>'
      );
    };
    return (
      '<div class="seg studio-mode" role="radiogroup" aria-label="Report">' +
      btn('grade', 'Quick Report', grade) +
      btn('build', 'Custom', !grade) +
      '</div>'
    );
  }
  // html-safe: literal labels, keys and values only
  function _gradePanelHtml() {
    var o = _gradeOpts();
    var check = function (key, label, off) {
      return (
        '<label class="studio-check' +
        (off ? ' is-off' : '') +
        '"><input type="checkbox" data-action="gradeOption" data-key="' +
        key +
        '"' +
        (o[key] ? ' checked' : '') +
        (off ? ' disabled' : '') +
        '><span>' +
        label +
        '</span></label>'
      );
    };
    var order = function (v, label) {
      return (
        '<button type="button" class="seg-btn' +
        (o.order === v ? ' active' : '') +
        '" data-action="gradeOrder" data-value="' +
        v +
        '" role="radio" aria-checked="' +
        (o.order === v) +
        '">' +
        label +
        '</button>'
      );
    };
    return (
      '<div class="gr-panel">' +
      '<h4>Grade Sheet</h4>' +
      check('summary', 'Category Summary') +
      check('ungraded', 'Ungraded Assignments') +
      check('numbers', 'Assignment Numbers') +
      // The Feedback Pages switch. Off greys the choices under it and keeps
      // their ticks: their saved values are not touched.
      '<div class="gr-switch-row"><h4>Feedback Pages</h4>' +
      '<button type="button" class="gr-switch" role="switch" data-action="gradeFeedback" aria-label="Feedback Pages" aria-checked="' +
      !!o.feedback +
      '"><span class="gr-switch-knob"></span></button></div>' +
      '<div class="gr-sub">' +
      check('rubrics', 'Rubrics', !o.feedback) +
      check('comments', 'Assignment Comments', !o.feedback) +
      check('observations', 'Observations', !o.feedback) +
      check('termComment', 'Term Comment', !o.feedback) +
      '</div>' +
      '<h4>Order</h4>' +
      '<div class="seg seg-sm" role="radiogroup" aria-label="Order">' +
      order('oldest', 'Oldest First') +
      order('newest', 'Newest First') +
      '</div></div>'
    );
  }

  /* Saves this page's copy of the report settings, with the comment
     settings the Term Questionnaire saved since the page loaded it (its
     support lines, closing sentence and character limit), so a change here
     never puts back older ones. */
  function _saveReportConfig() {
    var saved = (typeof getReportConfig === 'function' && getReportConfig(activeCourse)) || {};
    if (saved.commentSettings) reportConfig.commentSettings = saved.commentSettings;
    else delete reportConfig.commentSettings;
    saveReportConfig(activeCourse, reportConfig);
  }

  function _loadReportConfig(cid) {
    // Changes Apply To a student ends with the class it was set in.
    _oneForStudent = false;
    var rc = Object.assign({}, (typeof getReportConfig === 'function' && getReportConfig(cid)) || {});
    // Progress Reports opens on the Grade Report, or on Build Your Own for a
    // class that built a report before there was a choice.
    if (rc.progressMode !== 'grade' && rc.progressMode !== 'build') rc.progressMode = rc.form ? 'build' : 'grade';
    rc.form = ReportSheets.formFor(rc);
    rc.preset = 'standard';
    return rc;
  }

  /* A control in the palette that has focus, as a selector that finds the
     same control after the palette is redrawn (the class fit redraws it a
     moment after an option changes). */
  function _focusedPaletteControl(palette) {
    var el = document.activeElement;
    if (!palette || !el || !palette.contains(el) || !el.dataset || !el.dataset.action) return null;
    var sel = '[data-action="' + el.dataset.action + '"]';
    ['key', 'value', 'mode', 'tab', 'block', 'part', 'opt'].forEach(function (k) {
      if (el.dataset[k] != null) sel += '[data-' + k + '="' + el.dataset[k] + '"]';
    });
    return sel;
  }

  function renderStudioPanels() {
    var palette = document.getElementById('studio-palette');
    var refocus = _focusedPaletteControl(palette);
    if (palette && _isOne()) {
      ReportOnePanel.render(palette, _oneApi());
      palette.setAttribute('aria-label', 'Report');
    } else if (palette && _isGrade()) {
      palette.innerHTML = _modeSwitchHtml() + _gradePanelHtml();
      palette.setAttribute('aria-label', 'Quick Report');
    } else if (palette) {
      palette.setAttribute('aria-label', 'Blocks');
      if (_blockSizes === null || _blockSizesSet !== _reportSet()) {
        _blockSizes = _measureBlockSizes();
        _blockSizesSet = _reportSet();
      }
      palette.innerHTML = ReportStudio.paletteHtml(
        _formOf(),
        studioTab,
        ReportSheets.templates(),
        _blockSizes,
        _classFitKey === _classFitKeyNow() ? _classFit : null,
        studioTab === 'templates' ? _templateThumbs() : null,
      );
      palette.insertAdjacentHTML('afterbegin', _modeSwitchHtml());
      ReportStudio.fitThumbs(palette);
    }
    var again = refocus && palette && palette.querySelector(refocus);
    if (again && again.focus) again.focus();
    _renderFitLine();
  }

  function _renderFitLine() {
    var line = document.getElementById('studio-fit');
    if (!line) return;
    if (_isOne()) {
      // html-safe: ReportOnePanel.fitHtml escapes the names it prints
      line.innerHTML = ReportOnePanel.fitHtml(_oneApi());
      line.classList.toggle('ok', !line.querySelector('.one-fit-over'));
      return;
    }
    line.innerHTML = ReportStudio.fitLineHtml(
      _classFitKey === _classFitKeyNow() ? _classFit : null,
      _isGrade() ? null : _formOf(),
      _isGrade()
        ? {
            over: 'Too many assessments to fit on one sheet for ',
            feedbackOver: 'A feedback card is taller than a page for ',
          }
        : null,
    );
    line.classList.toggle('ok', !!line.textContent && !line.firstElementChild);
  }

  /* Each starter and saved template drawn with the previewed student's
     real report, for the Templates tab: { id: { html, sheets } }. Measured
     once per class, student, paper, library and set of scores. */
  var _thumbCache = { key: '', thumbs: null };
  function _templateThumbs() {
    var st = _previewStudent();
    if (!st) return null;
    var list = ReportSheets.templates();
    var key = [
      activeCourse,
      st.id,
      reportPaper,
      ReportBlocks.reportContext().termId,
      JSON.stringify(list),
      _reportSet(),
    ].join('|');
    if (_thumbCache.key === key) return _thumbCache.thumbs;
    var out = {};
    var ctx = ReportBlocks.reportContext();
    var draw = function (id, form) {
      try {
        out[id] = ReportSheets.thumbs(activeCourse, st, ctx, { form: form, paper: reportPaper });
      } catch (e) {
        out[id] = null;
      }
    };
    ReportSheets.starters().forEach(function (s) {
      draw(s.id, ReportSheets.starter(s.id));
    });
    list.forEach(function (t) {
      draw(t.id, t.form);
    });
    _thumbCache = { key: key, thumbs: out };
    return out;
  }

  /* Every block at both widths for every student: the tallest wins, so
     the palette knows where a block has room for the whole class. */
  function _measureBlockSizes() {
    try {
      var students = sortStudents(getStudents(activeCourse), 'lastName');
      if (!students.length) return {};
      return ReportSheets.blockSizes(activeCourse, students, ReportBlocks.reportContext(), {
        paper: reportPaper,
        type: _formOf().type,
        form: _formOf(),
      });
    } catch (e) {
      return {};
    }
  }

  /* Where a block from the palette lands: the Front when it has room for
     every student, else the Back (the toast says so), else after the
     report when it is taller than a side. Null when nothing fits. */
  function _landing(id) {
    var f = _formOf();
    var land = ReportStudio.landing(f, id, _blockSizes, _classFitKey === _classFitKeyNow() ? _classFit : null);
    if (!land) return { side: f.sides.length - 1 };
    if (land.reason) return null;
    if (land.after) return { side: f.sides.length - 1, after: true };
    return land;
  }

  /* The whole class laid out on the form, for the fit line, once per
     class, report, paper, form and set of scores, after the canvas has
     rendered. In Everyone view the canvas render is that summary. */
  var _classFit = null;
  var _classFitKey = '';
  function _classFitKeyNow() {
    var ctx = ReportBlocks.reportContext();
    return [
      activeCourse,
      ctx.termId,
      reportPaper,
      _isOne() ? 'one:' + JSON.stringify(_oneModel()) : '',
      _isGrade() ? 'grade:' + JSON.stringify(_gradeOpts()) : JSON.stringify(_formOf()),
      _reportSet(),
    ].join('|');
  }
  /* Every student laid out, off the canvas: the grades are read here, when
     the timer below runs, inside the report's set of scores. */
  function _classSummary(students) {
    return ReportSheets.classSummary(activeCourse, students, ReportBlocks.reportContext(), {
      paper: reportPaper,
      form: _formOf(),
      layout: _layout(),
    });
  }
  function _scheduleClassFit() {
    if (activeTab !== 'progress') return;
    var key = _classFitKeyNow();
    if (key === _classFitKey) {
      _renderFitLine();
      // The rail's sheet badges follow the whole class's fit, as the fit
      // line does (step 4 group 2 #9).
      if (_classFit) _annotateSidebar(_classFit);
      return;
    }
    _classFitKey = key;
    setTimeout(function () {
      if (!_mounted || key !== _classFitKey || activeTab !== 'progress') return;
      try {
        var students = sortStudents(getStudents(activeCourse), 'lastName');
        _classFit = _classSummary(students);
      } catch (e) {
        _classFit = null;
      }
      // The palette greys the blocks with no room once the fit is in, and
      // every student's badge in the rail is redrawn from it: a render of
      // one student only redraws that student's (step 4 group 2 #9).
      renderStudioPanels();
      if (_classFit) _annotateSidebar(_classFit);
      // The summary names the longest report; the canvas moves to it.
      if (previewAuto && studioView === 'one') {
        var longest = ReportStudio.longestStudent(_classFit);
        if (longest) {
          previewAuto = false;
          if (longest !== previewSid) {
            previewSid = longest;
            renderReportPreview();
          }
        }
      }
    }, 0);
  }

  /* Your Templates are the teacher's, on the server (report_template);
     this device keeps a copy that shows at once. */
  function _syncTemplates() {
    if (typeof ReportSheets.syncTemplates !== 'function') return;
    ReportSheets.syncTemplates().then(function (changed) {
      if (changed && _mounted && studioTab === 'templates' && activeTab === 'progress') renderStudioPanels();
    });
  }

  var SAVE_TEMPLATE_ID = 'save-template-overlay';
  function _closeSaveTemplate() {
    var o = document.getElementById(SAVE_TEMPLATE_ID);
    if (o) o.remove();
    var b = document.getElementById('tb-save-template');
    if (b) b.focus();
  }
  function _openSaveTemplate() {
    _closeSaveTemplate();
    var form = _formOf();
    var starter = ReportSheets.starters().some(function (st) {
      return st.id === form.id && st.name === form.name;
    });
    var overlay = document.createElement('div');
    overlay.id = SAVE_TEMPLATE_ID;
    overlay.className = 'confirm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'save-template-title');
    overlay.innerHTML =
      '<form class="confirm-card studio-save-card" id="save-template-form">' +
      '<div class="confirm-title" id="save-template-title">Save as Template</div>' +
      '<label class="studio-save-label" for="save-template-name">Name</label>' +
      '<input type="text" class="studio-text" id="save-template-name" maxlength="60" required value="' +
      esc(starter ? '' : form.name || '') +
      '">' +
      '<div class="confirm-actions"><button type="button" class="confirm-cancel" data-save="cancel">Cancel</button>' +
      '<button type="submit" class="confirm-ok primary">Save</button></div></form>';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || (e.target.closest && e.target.closest('[data-save="cancel"]'))) _closeSaveTemplate();
    });
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') _closeSaveTemplate();
    });
    overlay.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = overlay.querySelector('#save-template-name').value.trim();
      if (!name) return;
      var entry = ReportSheets.saveTemplate(name, Object.assign({}, _formOf(), { name: name, id: 'custom' }));
      _closeSaveTemplate();
      if (!entry) return;
      studioTab = 'templates';
      renderStudioPanels();
    });
    document.body.appendChild(overlay);
    var input = overlay.querySelector('#save-template-name');
    if (input) input.focus();
  }

  function _selectBlock(id) {
    studioSelected = id || null;
    var preview = document.getElementById('rb-preview');
    if (preview) _applySelection(preview);
  }

  function _announce(text) {
    var live = document.getElementById('studio-live');
    if (live) live.textContent = text;
  }

  function _previewStudent() {
    return _previewStudents()[0] || null;
  }

  /* The pointer and keyboard work on the page (report-studio.js). Every
     edit goes through _setForm, which saves and offers Undo. A drop on a
     side with no room for every student lands on the next side that has
     it, and the toast says so. */
  var _studioKeys = null;
  var _studioDrag = null;
  function _mountStudioKeys() {
    if (_studioKeys) _studioKeys.destroy();
    if (_studioDrag) _studioDrag.destroy();
    _studioKeys = _studioDrag = null;
    // One Report's pages have their own controls; the old editor's keys
    // and dragging would change the built form under them.
    if (_isOne()) return;
    var root = document.getElementById('studio');
    if (!root) return;
    var fit = function () {
      return _classFitKey === _classFitKeyNow() ? _classFit : null;
    };
    _studioDrag = ReportStudio.initDrag(root, {
      form: _formOf,
      sizes: function () {
        return _blockSizes;
      },
      canHalf: ReportSheets.canHalf,
      insert: function (id, to) {
        var f = _formOf();
        var was = ReportSheets.locate(f, id);
        var label = (was ? 'Moved ' : 'Added ') + _label(id);
        // A side with no room for every student passes the block on to the
        // next side that has it (the sides after it first).
        if (ReportStudio.fitsOn(f, id, to.side, _blockSizes, fit()) === false) {
          var order = [];
          for (var s = to.side + 1; s < f.sides.length; s++) order.push(s);
          for (var t = 0; t < to.side; t++) order.push(t);
          var next = order.find(function (s) {
            return ReportStudio.fitsOn(f, id, s, _blockSizes, fit());
          });
          if (next != null) {
            var full =
              to.side === 0 && next > 1
                ? 'The Front and Back are full'
                : to.side === 0
                  ? 'The Front is full'
                  : to.side === 1
                    ? 'The Back is full'
                    : 'That page is full';
            label += ' to ' + ReportStudio.sideWhere(next) + '. ' + full;
            to = { side: next };
          }
        }
        _setForm(ReportSheets.insert(f, id, to), label);
      },
      beside: function (id, target) {
        var f = _formOf();
        _setForm(ReportSheets.beside(f, id, target), 'Put ' + _label(id) + ' beside ' + _label(target));
      },
      select: _selectBlock,
      announce: _announce,
      html: function (id, size) {
        return _blockHtml(id, size);
      },
    });
    var keepFocus = function (id) {
      if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.sheet-cell')) {
        _focusBlock = id;
      }
    };
    _studioKeys = ReportStudio.initKeys(root, {
      form: _formOf,
      move: function (id, dir) {
        keepFocus(id);
        _moveBlock(id, dir);
      },
      remove: _removeBlock,
      select: function (id) {
        _focusBlock = id;
        _selectBlock(id);
      },
      announce: _announce,
      escape: _studioEscape,
    });
  }

  /* Escape on Progress Reports closes the Blocks panel on a narrow screen,
     else the selected block's card, focus going back to the block (step 4
     group 3 #64). A dialog over the page keeps Escape for itself. */
  function _studioEscape(e) {
    if (activeTab !== 'progress' || document.querySelector('.confirm-overlay, .studio-dragging')) return false;
    // An Escape a dialog used to close itself (it is gone from the page) or
    // pressed inside one is the dialog's.
    var t = e && e.target;
    if (t && t.nodeType === 1 && (!t.isConnected || (t.closest && t.closest('[role="dialog"]')))) return false;
    var layout = document.getElementById('studio');
    var rail = document.getElementById('tb-rail-btn');
    if (layout && layout.classList.contains('rail-open')) {
      layout.classList.remove('rail-open');
      if (rail) {
        rail.classList.remove('active');
        rail.setAttribute('aria-pressed', 'false');
        rail.focus();
      }
      return true;
    }
    if (studioSelected) {
      var id = studioSelected;
      _focusBlock = id;
      _selectBlock(null);
      return true;
    }
    return false;
  }

  function _label(id) {
    return ReportSheets.BLOCKS[id] ? ReportSheets.BLOCKS[id].label : id;
  }
  /* A block rendered for the previewed student, for the ghost and the
     palette's previews. */
  function _blockHtml(id, size) {
    var st = _previewStudent();
    if (!st) return '';
    var cell = ReportSheets.cellOf(_formOf(), id) || { block: id, size: size || 'row' };
    try {
      return ReportBlocks.renderReportBlock(
        id,
        activeCourse,
        st,
        ReportBlocks.reportContext(),
        ReportSheets.optionsFor(cell),
      );
    } catch (e) {
      return '';
    }
  }

  /* Holding the pointer on a block in the palette shows it at its real
     size for the previewed student, beside the palette. */
  var PEEK_SCALE = 0.47; // reports.css .studio-peek-sheet
  var _peekTimer = null;
  var _peekFor = null; // the palette button the pointer rests on
  function _hidePeek() {
    clearTimeout(_peekTimer);
    _peekTimer = null;
    _peekFor = null;
    var p = document.getElementById('studio-peek');
    if (p) p.remove();
  }
  function _handlePeekOver(e) {
    var btn = e.target.closest ? e.target.closest('#studio-palette .studio-blk[data-block]') : null;
    if (!btn || (_studioDrag && _studioDrag.dragging())) return;
    _hidePeek();
    _peekFor = btn;
    _peekTimer = setTimeout(function () {
      if (_peekFor !== btn) return;
      var id = btn.dataset.block;
      var html = _blockHtml(id, 'row');
      if (!html) return;
      var st = _previewStudent();
      var wrap = document.createElement('div');
      wrap.innerHTML = ReportStudio.peekHtml(_label(id), st ? fullName(st) : '', html);
      var peek = wrap.firstElementChild;
      peek.id = 'studio-peek';
      document.body.appendChild(peek);
      // The sheet is scaled with a transform, which leaves layout alone:
      // the box takes the scaled height by hand.
      var inner = peek.querySelector('.sheet-cell');
      peek.querySelector('.studio-peek-box').style.height = Math.ceil(inner.offsetHeight * PEEK_SCALE) + 'px';
      var br = btn.getBoundingClientRect();
      var top = Math.max(8, Math.min(br.top, window.innerHeight - peek.offsetHeight - 8));
      peek.style.left = br.right + 10 + 'px';
      peek.style.top = top + 'px';
    }, 350);
  }
  function _handlePeekOut(e) {
    var btn = e.target.closest ? e.target.closest('#studio-palette .studio-blk[data-block]') : null;
    if (!btn) return;
    var to = e.relatedTarget;
    if (to && btn.contains(to)) return;
    _hidePeek();
  }
  function _moveBlock(id, dir) {
    var f = _formOf();
    var next = ReportSheets.moveRow(f, id, dir);
    if (JSON.stringify(next) === JSON.stringify(f)) return;
    _setForm(next, 'Moved ' + _label(id) + (dir < 0 ? ' up' : ' down'));
  }
  /* Selects a placed block on the previewed student's page and brings it
     into view, from the palette. Everyone view switches to One Student,
     where a block can be selected. */
  function _findBlock(id) {
    if (studioView !== 'one') {
      studioView = 'one';
      studioSelected = id;
      renderReports();
    } else _selectBlock(id);
    var cell = document.querySelector('#rb-preview .sheet-body .sheet-cell[data-block="' + id + '"]');
    if (cell) {
      cell.scrollIntoView({ block: 'nearest' });
      cell.focus({ preventScroll: true });
    }
    _announce(ReportStudio.placeText(_formOf(), id) + '.');
  }
  function _removeBlock(id) {
    if (studioSelected === id) studioSelected = null;
    _setForm(ReportSheets.removeCell(_formOf(), id), 'Removed ' + _label(id));
    _announce(_label(id) + ' removed from the report.');
  }

  /* ── Course switching ────────────────────────────────────────── */
  async function switchCourse(cid) {
    // The Print dialog and any question over it are this class's.
    closeIssueDialog();
    RQ.tqSaveCurrentIfNeeded();
    // A pending Undo belongs to the class being left.
    if (typeof dismissUndoToast === 'function') dismissUndoToast();
    activeCourse = cid;
    if (!(await switchActiveCourse(cid))) return;
    // The teacher may have left Reports while the class loaded.
    if (!_mounted) return;
    selectedStudentIds = null; // reset to all
    viewingIssue = null;
    reportPaper = _loadPaper(cid);
    _applyPaper();
    reportConfig = _loadReportConfig(cid);
    _blockSizes = null;
    _classFitKey = '';
    previewSid = null;
    previewAuto = true;
    studioSelected = null;
    _configureQuestionnaire();
    populateStudentSelect();
    populateReportPeriods(false);
    renderReports();
    _syncFromServer(cid);
    document.getElementById('sidebar-mount').innerHTML = renderSidebar(cid, null);
  }

  /* ── Questionnaire delegation (now in report-questionnaire.js) ── */
  var RQ = ReportQuestionnaire;
  function getTqStudents() {
    return RQ.getTqStudents();
  }
  function tqPrevStudent() {
    RQ.tqPrevStudent();
  }
  function tqNextStudent() {
    RQ.tqNextStudent();
  }
  function tqSaveCurrentIfNeeded() {
    RQ.tqSaveCurrentIfNeeded();
  }
  function tqCopyNarrative() {
    RQ.tqCopyNarrative();
  }
  function tqSelectStudent(sid) {
    RQ.tqSelectStudent(sid);
  }
  // html-safe: returns ReportQuestionnaire.renderTermQuestionnaire, which is checked
  function renderTermQuestionnaire(cid) {
    return RQ.renderTermQuestionnaire(cid);
  }

  function _configureQuestionnaire() {
    RQ.configure({
      activeCourse: activeCourse,
      renderReports: renderReports,
      onLastStudent: function () {
        switchTab('progress');
      },
      // The Edit Student icon opens the Student Dashboard's dialog; a save
      // redraws this page with the new name or pronouns.
      openEditStudent: function (cid, sid) {
        if (typeof PageStudent !== 'undefined' && PageStudent.openEditStudent) {
          PageStudent.openEditStudent(cid, sid, function () {
            document.getElementById('sidebar-mount').innerHTML = renderSidebar(activeCourse, null);
            renderReports();
          });
        }
      },
    });
  }

  /* ── Init ────────────────────────────────────────────────────── */

  // ── Delegated click handler for reports ──

  // Handle report-period select change via delegation

  // Intercept sidebar clicks — navigate to that student contextually

  /* -- Delegated click handler ---------------------------- */
  function _handleClick(e) {
    if (!e.target.closest('.student-picker')) {
      var dd = document.getElementById('picker-dropdown');
      if (dd) dd.classList.remove('open');
    }

    var cell = e.target.closest('.studio-pages .sheet-body .sheet-cell[data-block]');
    if (cell && studioView === 'one' && !viewingIssue && !_isOne()) {
      _selectBlock(cell.dataset.block);
      return;
    }

    // A click outside the IE deadline calendar closes it.
    if (RQ.deadlineOpen() && !e.target.closest('#tq-cal, #tq-deadline-btn')) RQ.tqCloseDeadline();
    // And outside the Support Line menu or the character limit.
    if (RQ.linesOpen()) RQ.clickOutside(e.target);

    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.dataset.action;
    // One Report's own controls (data-action="one…") go to its panel and page.
    if (_isOne() && /^one[A-Z]/.test(action)) {
      if (ReportOnePanel.handle(action, el, _oneApi(), e)) return;
      if (typeof ReportOnePage !== 'undefined' && ReportOnePage.handle(action, el, _oneApi(), e)) return;
    }
    var handlers = {
      switchTab: function () {
        switchTab(el.dataset.tab);
      },
      tqSetBasis: function () {
        RQ.tqSetBasis(el.dataset.basis);
      },
      tqOpenDeadline: function () {
        if (RQ.deadlineOpen()) RQ.tqCloseDeadline();
        else RQ.tqOpenDeadline();
      },
      tqDeadlineMonth: function () {
        RQ.tqDeadlineMonth(el.dataset.dir);
      },
      tqPickDeadline: function () {
        RQ.tqPickDeadline(el.dataset.date);
      },
      tqAddReportNote: function () {
        RQ.tqAddReportNote(el.dataset.aid);
      },
      // At a Glance: a piece's title or Open in Grader, and a row that
      // opens to list its pieces.
      tqOpenGrader: function () {
        RQ.tqOpenGrader(el.dataset.aid);
      },
      tqGlanceToggle: function () {
        RQ.tqGlanceToggle(el.dataset.row);
      },
      // At a Glance's View All Skills, and the drawer's ✕.
      tqOpenSkills: function () {
        RQ.tqOpenSkills(el);
      },
      tqCloseDrawer: function () {
        RQ.tqCloseDrawer();
      },
      // The Observations card's strip, View All and rows; the drawer's
      // strip, Show More and Show All.
      tqOpenObs: function () {
        RQ.tqOpenObs(el.dataset.filter, el);
      },
      tqOpenObsAt: function () {
        RQ.tqOpenObsAt(el.dataset.obid, el);
      },
      tqObsFilter: function () {
        RQ.tqObsFilter(el.dataset.filter);
      },
      tqObsMore: function () {
        RQ.tqObsMore(el.dataset.obid);
      },
      tqObsShowAll: function () {
        RQ.tqObsShowAll();
      },
      // The class's lines on the Sentences card and the character limit.
      tqLine: function () {
        RQ.tqLine(el.dataset.do, el);
      },
      // The Sentences card's rows, Other Wording and Browse Sentences.
      tqSentences: function () {
        RQ.tqSentences(el.dataset.do, el);
      },
      // Marks changed after approval: Keep as Approved or Use the New Sentence.
      tqStale: function () {
        RQ.tqStale(el.dataset.do, el.dataset.i);
      },
      tqClaim: function () {
        RQ.tqClaim(el.dataset.do, el.dataset.row);
      },
      toggleStudentPicker: function () {
        toggleStudentPicker(e);
      },
      tqPrevStudent: function () {
        tqPrevStudent();
      },
      tqNextStudent: function () {
        tqNextStudent();
      },
      printReports: function () {
        // One Report: a comment edited on the page is saved or discarded first.
        if (_isOne() && typeof ReportOnePage !== 'undefined' && ReportOnePage.beforePrint(_oneApi()) === false) return;
        // A chosen copy prints as it is; the live reports save a copy, then print.
        var t = _tab();
        if (viewingIssue) _printIssue();
        else if (t.print) t.print();
        else _printNow();
      },
      setPaper: function () {
        setPaper(el.dataset.paper);
        _blockSizes = null;
        renderStudioPanels();
      },
      setSides: function () {
        var n = el.dataset.sides === '1' ? 1 : 2;
        var f = _formOf();
        if ((f.sides.length === 1) === (n === 1)) return;
        _setForm(ReportSheets.setSides(f, n), n === 1 ? 'Front only' : 'Front and Back');
        _syncSidesButtons();
      },
      studioView: function () {
        studioView = el.dataset.view === 'all' ? 'all' : 'one';
        renderReports();
      },
      studioTab: function () {
        studioTab = el.dataset.tab === 'templates' ? 'templates' : 'blocks';
        renderStudioPanels();
        if (studioTab === 'templates') _syncTemplates();
      },
      studioBlock: function () {
        // A block already on the form is found on the page: selected, with
        // its card, and scrolled to (DECISIONS "Report forms" 13; it was
        // removed, step 4 group 2 #8). Remove is on its card. One that isn't
        // lands in a row of its own: on the Front when it has room for
        // every student, else on the Back, with a toast that says so. A
        // block taller than a side prints after the report.
        var id = el.dataset.block;
        var f = _formOf();
        if (ReportSheets.locate(f, id)) return _findBlock(id);
        if (el.getAttribute('aria-disabled') === 'true') return;
        var land = _landing(id);
        if (!land) return;
        studioSelected = id;
        var label = 'Added ' + _label(id);
        if (land.after) label += '. It prints after the report';
        else if (land.side > 0 && f.sides.length > 1)
          label +=
            ' to ' +
            ReportStudio.sideWhere(land.side) +
            (land.side > 1 ? '. The Front and Back are full' : '. The Front is full');
        _setForm(ReportSheets.insert(f, id, { side: land.side }), label);
        _announce(ReportStudio.placeText(_formOf(), id) + '.');
      },
      studioChoice: function () {
        var v = el.dataset.value;
        _setForm(
          ReportSheets.setOption(_formOf(), el.dataset.block, el.dataset.key, /^\d+$/.test(v) ? Number(v) : v),
          'Changed ' + _label(el.dataset.block) + ' options',
        );
      },
      studioNoEvidence: function () {
        _setForm(
          ReportSheets.setNoEvidence(_formOf(), el.dataset.block, el.dataset.rule),
          'Changed ' + _label(el.dataset.block) + ' options',
        );
      },
      studioLines: function () {
        var id = el.dataset.block;
        var cur = ReportSheets.optionsFor(ReportSheets.cellOf(_formOf(), id) || { block: id }).lines;
        var n = cur + (Number(el.dataset.dir) || 1);
        _setForm(ReportSheets.setLines(_formOf(), id, n), _label(id) + ': ' + n + ' lines');
      },
      studioSize: function () {
        var id = el.dataset.block;
        var size = el.dataset.size === 'half' ? 'half' : 'row';
        var f = _formOf();
        if ((ReportSheets.cellOf(f, id) || {}).size === size) return;
        _setForm(
          ReportSheets.setSize(f, id, size, ReportStudio.halfHeights(_blockSizes)),
          _label(id) + ': ' + (size === 'half' ? 'Side by Side' : 'Row'),
        );
      },
      studioMove: function () {
        _moveBlock(el.dataset.block, Number(el.dataset.dir) || 1);
      },
      studioMoveSide: function () {
        var id = el.dataset.block;
        var to = Number(el.dataset.side) || 0;
        _setForm(
          ReportSheets.moveToSide(_formOf(), id, to),
          'Moved ' + _label(id) + ' to ' + ReportStudio.sideWhere(to),
        );
        _announce(ReportStudio.placeText(_formOf(), id) + '.');
      },
      studioLeaveOff: function () {
        var on = el.getAttribute('aria-pressed') !== 'true';
        var st = _previewStudent();
        var first = st ? fullName(st).split(/\s+/)[0] : 'this student';
        _setForm(
          ReportSheets.hideFor(_formOf(), el.dataset.sid, el.dataset.block, on),
          (on ? 'Left off ' : 'Put back ') + _label(el.dataset.block) + ' for ' + first,
        );
      },
      studioRemove: function () {
        _removeBlock(el.dataset.block);
      },
      studioAddSide: function () {
        _setForm(ReportSheets.addSide(_formOf()), 'Added a page');
        _syncSidesButtons();
      },
      studioRemoveSide: function () {
        _setForm(ReportSheets.removeSide(_formOf(), Number(el.dataset.side)), 'Removed the empty page');
        _syncSidesButtons();
      },
      studioTemplate: function () {
        var f = el.dataset.starter ? ReportSheets.starter(el.dataset.starter) : ReportSheets.template(el.dataset.id);
        if (!f) return;
        var name = ((el.querySelector && el.querySelector('.studio-blk-name')) || el).textContent.trim();
        studioSelected = null;
        _setForm(f, 'Applied ' + name);
        _syncSidesButtons();
      },
      studioTemplateDelete: function () {
        var t = ReportSheets.templates().find(function (x) {
          return x.id === el.dataset.id || x.localId === el.dataset.id;
        });
        if (!t) return;
        ReportSheets.removeTemplate(t.id);
        renderStudioPanels();
        if (typeof showUndoToast === 'function') {
          showUndoToast('Deleted ' + t.name, function () {
            ReportSheets.saveTemplate(t.name, t.form);
            renderStudioPanels();
          });
        }
      },
      openSaveTemplate: function () {
        _openSaveTemplate();
      },
      togglePhones: function () {
        phonesView = !phonesView;
        _syncPhonesButton();
        renderReports();
      },
      progressMode: function () {
        _setProgressMode(el.dataset.mode);
      },
      gradeFeedback: function () {
        _setGradeOption('feedback', !_gradeOpts().feedback);
        var sw = document.querySelector('#studio-palette .gr-switch');
        if (sw) sw.focus();
      },
      gradeOrder: function () {
        _setGradeOption('order', el.dataset.value === 'newest' ? 'newest' : 'oldest');
      },
      toggleRail: function () {
        // Narrow screens hide the palette; this opens it over the pages.
        var layout = document.getElementById('studio');
        if (!layout) return;
        var open = layout.classList.toggle('rail-open');
        el.classList.toggle('active', open);
        el.setAttribute('aria-pressed', open ? 'true' : 'false');
        if (open) ReportStudio.fitThumbs(document.getElementById('studio-palette'));
      },
      stepStudent: function () {
        // One student at a time, in roster order; All becomes the first or last.
        var students = sortStudents(getStudents(activeCourse), 'lastName');
        if (!students.length) return;
        var dir = Number(el.dataset.dir) || 1;
        var ids = students.map(function (st) {
          return st.id;
        });
        var at = selectedStudentIds && selectedStudentIds.length === 1 ? ids.indexOf(selectedStudentIds[0]) : -1;
        var next = at < 0 ? (dir > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, at + dir));
        selectedStudentIds = [ids[next]];
        populateStudentSelect();
        renderReports();
      },
      fitMapPick: function () {
        // In Everyone view a student's thumbnail opens that student.
        if (studioView !== 'all') return;
        previewSid = el.dataset.sid;
        previewAuto = false;
        studioView = 'one';
        renderReports();
      },
      toggleStudentSelection: function () {
        e.stopPropagation();
        toggleStudentSelection(el.dataset.sid);
      },
      selectAllStudents: function () {
        e.stopPropagation();
        selectAllStudents();
      },
      selectNoneStudents: function () {
        e.stopPropagation();
        selectNoneStudents();
      },
      tqCopyNarrative: function () {
        tqCopyNarrative();
      },
      tqApproveNext: function () {
        RQ.tqApproveNext();
      },
      tqCommentTab: function () {
        RQ.tqCommentTab(el.dataset.tab);
      },
      tqRosterFilter: function () {
        RQ.tqRosterFilter(el.dataset.filter);
      },
      tqGenerate: function () {
        RQ.tqGenerate();
      },
      tqRate: function () {
        RQ.tqRate(el.dataset.habit, el.dataset.value);
      },
      tqInfo: function () {
        RQ.tqOpenInfo();
      },
      tqCloseInfo: function () {
        RQ.tqCloseInfo();
      },
      tqShowBoth: function () {
        RQ.tqShowBoth();
      },
      tqCloseBoth: function () {
        RQ.tqCloseBoth();
      },
      tqEditStudent: function () {
        RQ.tqEditStudent();
      },
    };
    if (handlers[action]) {
      handlers[action]();
    } else if (/^pp[A-Z]/.test(action) && typeof PhoneReports !== 'undefined') {
      e.preventDefault();
      PhoneReports.handleAction(action, el, activeCourse, ReportBlocks.reportContext());
    }
  }

  function _handleStudioChange(e) {
    var el = e.target;
    if (!el || !el.dataset) return;
    // The questionnaire's attendance boxes save when they change.
    if (el.dataset.tqAtt) {
      RQ.tqSetAttendance(el.dataset.sid);
      return;
    }
    // A support or language goal line ticked, or the character limit typed.
    if (el.dataset.tqSupport || el.dataset.tqLang || el.dataset.tqLimit) {
      RQ.tqLineChange(el);
      return;
    }
    // "Belongs under" for a sentence of the teacher's own.
    if (el.dataset.tqOwn) {
      RQ.tqSentences('ownBind', el);
      return;
    }
    // "I checked this" on a highlighted row of the Sentences card.
    if (el.dataset.tqCheck) {
      RQ.tqSetCheck(el.dataset.tqCheck, !!el.checked);
      return;
    }
    var a = el.dataset.action;
    if (_isOne() && a && /^one[A-Z]/.test(a)) {
      if (ReportOnePanel.change && ReportOnePanel.change(a, el, _oneApi())) return;
      if (typeof ReportOnePage !== 'undefined' && ReportOnePage.change && ReportOnePage.change(a, el, _oneApi()))
        return;
    }
    if (a === 'gradeOption') {
      _setGradeOption(el.dataset.key, !!el.checked);
    } else if (a === 'studioOption') {
      _setForm(
        ReportSheets.setOption(_formOf(), el.dataset.block, el.dataset.key, el.checked),
        'Changed ' + _label(el.dataset.block) + ' options',
      );
    } else if (a === 'studioText') {
      _setForm(ReportSheets.setOption(_formOf(), el.dataset.block, el.dataset.key, el.value));
    }
  }

  // The CSP blocks inline on* attributes, so the comment box's typing is heard here.
  function _handleNarrativeInput(e) {
    if (e.target && e.target.id === 'tq-narrative') RQ.tqNarrativeInput();
    else if (e.target && e.target.id === 'tq-browse-search') RQ.tqSentences('search', e.target);
    else if (e.target && e.target.id === 'tq-own-input') RQ.tqSentences('ownInput', e.target);
    else if (e.target && e.target.id === 'tq-obs-search') RQ.tqObsSearch(e.target.value);
  }

  /* A key press goes to the open tab, when it listens for keys. */
  function _handleTabKey(e) {
    var t = _tab();
    if (t.key) t.key(e);
  }

  function _handleReportPeriodChange() {
    // The box knows the report it was drawn for, so this saves there.
    RQ.tqSaveCurrentIfNeeded();
    viewingIssue = null;
    // A different report term means different work and heights.
    _blockSizes = null;
    renderReports();
  }

  function _handleCopyChange(e) {
    _showIssue(e.target.value);
  }

  /* The issued copies are kept on the server; this device's copies show at
     once and are refreshed from it when the page opens or the class
     changes. Demo Mode and offline keep the device copies. */
  function _syncFromServer(cid) {
    _syncTemplates();
    // Student Voice answers (Self-Assessment and Goal) arrive after the
    // class; the reports redraw once when they do.
    if (typeof StudentVoice !== 'undefined' && !StudentVoice.loaded(cid)) {
      StudentVoice.load(cid, function () {
        if (_mounted && cid === activeCourse && activeTab === 'progress') renderReports();
      });
    }
    // Attendance totals are read here, not with the class, and redraw the
    // page only when they changed and the teacher isn't typing in a box.
    if (typeof loadTermAttendance === 'function') {
      loadTermAttendance(cid).then(function (changed) {
        var typing = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.tqAtt;
        if (changed && _mounted && cid === activeCourse && !typing) renderReports();
      });
    }
    if (typeof ReportIssues !== 'undefined' && typeof ReportIssues.sync === 'function') {
      ReportIssues.sync(cid).then(function (changed) {
        if (changed && _mounted && cid === activeCourse) _populateCopies();
      });
    }
  }

  var _resizeTimer = null;
  function _handleResize() {
    var t = _tab();
    if (t.resize) t.resize();
  }

  function _handleSidebarClick(e) {
    var row = e.target.closest('.student-row');
    if (!row) return;
    e.preventDefault();
    var href = row.getAttribute('data-href') || '';
    var match = href.match(/id=([^&]+)/);
    if (!match) return;
    var sid = match[1];
    var t = _tab();
    if (t.pickStudent) t.pickStudent(sid);
  }

  /* -- Late policy contenteditable handlers (replaces inline onblur/onfocus) -- */
  function _handleLatePolicyFocus(e) {
    var el = e.target;
    if (!el || el.dataset.action !== 'latePolicyEdit') return;
    var cid = activeCourse;
    if (!(COURSES[cid] && COURSES[cid].lateWorkPolicy)) {
      el.textContent = '';
      el.style.color = 'var(--text-2)';
      el.style.fontStyle = 'normal';
    }
  }
  function _handleLatePolicyBlur(e) {
    var el = e.target;
    if (!el || el.dataset.action !== 'latePolicyEdit') return;
    var cid = activeCourse;
    var v = el.textContent.trim();
    var saved = (COURSES[cid] && COURSES[cid].lateWorkPolicy) || '';
    // The placeholder shown when nothing is set is not a policy.
    if (v === 'No late work policy set') v = '';
    if (v !== saved) updateCourse(cid, { lateWorkPolicy: v || null });
    el.style.color = v ? 'var(--text-2)' : 'var(--text-3)';
    el.style.fontStyle = v ? 'normal' : 'italic';
    if (!v) el.textContent = 'No late work policy set';
  }

  /* -- init / destroy ------------------------------------- */
  /* True from init to destroy: a load, save or timer that finishes after
     the teacher has left Reports draws nothing (as page-gradebook.js). */
  var _mounted = false;
  function init(params) {
    // The One Report switch is read again each time Reports opens.
    _oneOn = null;
    _mounted = true;
    activeCourse = params.course || getActiveCourse();
    setActiveCourse(activeCourse);
    activeTab = _tabIdFor(TABS, params.tab);
    selectedStudentIds = null;

    reportConfig = _loadReportConfig(activeCourse);
    _blockSizes = null;
    _classFitKey = '';
    _classFit = null;
    previewSid = null;
    studioSelected = null;
    _configureQuestionnaire();
    RQ.tqStudentIndex = 0;
    RQ.tqNarrativeDirty = false;

    // Show sidebar
    document.getElementById('sidebar-mount').style.display = '';
    document.getElementById('page-layout').classList.remove('sidebar-hidden');
    document.getElementById('sidebar-mount').innerHTML = renderSidebar(activeCourse, null);
    initSidebarToggle();

    // Render the toolbar + output container into main
    // html-safe: TOOLBAR_HTML is literal markup at the foot of this file, around _tabBarHtml, which is checked
    document.getElementById('main').innerHTML = TOOLBAR_HTML;

    reportPaper = _loadPaper(activeCourse);
    _applyPaper();

    // Wire report-period change
    populateReportPeriods(false);
    var reportPeriodEl = document.getElementById('report-period');
    if (reportPeriodEl) reportPeriodEl.addEventListener('change', _handleReportPeriodChange);
    var copyEl = document.getElementById('report-copy');
    if (copyEl) copyEl.addEventListener('change', _handleCopyChange);
    _syncFromServer(activeCourse);

    // Wire sidebar clicks
    var sidebarEl = document.getElementById('sidebar-mount');
    if (sidebarEl) sidebarEl.addEventListener('click', _handleSidebarClick);

    populateStudentSelect();

    // Handle params
    if (params.student) {
      var students = getTqStudents();
      var idx = students.findIndex(function (s) {
        return s.id === params.student;
      });
      if (idx >= 0) RQ.tqStudentIndex = idx;
    }

    switchTab(activeTab);

    // beforeunload handler — save unsaved narrative on browser close/refresh
    _beforeUnloadHandler = function () {
      if (RQ.tqNarrativeDirty) tqSaveCurrentIfNeeded();
    };
    window.addEventListener('beforeunload', _beforeUnloadHandler);

    window._pageSwitchCourse = switchCourse;

    _addDocListener('click', _handleClick);
    _addDocListener('pointerover', _handlePeekOver);
    _addDocListener('pointerout', _handlePeekOut);
    _addDocListener('pointerdown', _hidePeek);
    _addDocListener('change', _handleStudioChange);
    window.addEventListener('resize', _handleResize);
    _addDocListener('keydown', _handleTabKey);
    _addDocListener('input', _handleNarrativeInput);
    _addDocListener('focusin', _handleLatePolicyFocus);
    _addDocListener('focusout', _handleLatePolicyBlur);
  }

  function _teardownQuestionnaireTab() {
    // Save any unsaved narrative
    if (RQ.tqNarrativeDirty) tqSaveCurrentIfNeeded();
    RQ.restoreRoster();
    if (typeof clearLongFormAuthContext === 'function') clearLongFormAuthContext('term-rating');
  }

  function _teardownProgressTab() {
    _closeSaveTemplate();
    _hidePeek();
    if (_studioKeys) {
      _studioKeys.destroy();
      _studioKeys = null;
    }
    if (_studioDrag) {
      _studioDrag.destroy();
      _studioDrag = null;
    }
    var paperStyle = document.getElementById(PAPER_STYLE_ID);
    if (paperStyle) paperStyle.remove();
    if (typeof ReportSheets !== 'undefined') ReportSheets.clearPageStyle();
    _restoreSidebarBadges();
    closeIssueDialog();
    viewingIssue = null;
  }

  function destroy() {
    _mounted = false;
    clearTimeout(_resizeTimer);
    TABS.forEach(function (t) {
      if (t.teardown) t.teardown();
    });

    _listeners.forEach(function (l) {
      document.removeEventListener(l.type, l.handler, l.options);
    });
    _listeners = [];

    window.removeEventListener('resize', _handleResize);
    if (_beforeUnloadHandler) {
      window.removeEventListener('beforeunload', _beforeUnloadHandler);
      _beforeUnloadHandler = null;
    }

    // Clean up report-period and sidebar click listeners
    var reportPeriodEl = document.getElementById('report-period');
    if (reportPeriodEl) reportPeriodEl.removeEventListener('change', _handleReportPeriodChange);
    var copyEl = document.getElementById('report-copy');
    if (copyEl) copyEl.removeEventListener('change', _handleCopyChange);
    var sidebarEl = document.getElementById('sidebar-mount');
    if (sidebarEl) sidebarEl.removeEventListener('click', _handleSidebarClick);

    delete window._pageSwitchCourse;
  }

  /* -- Toolbar HTML (rendered into main on init) ---------- */
  var TOOLBAR_HTML =
    '<div class="page-toolbar report-toolbar no-print">\n      <div class="seg report-seg-control" role="tablist" aria-label="Report type">\n        ' +
    _tabBarHtml(TABS) +
    '\n      </div>\n      <div class="report-stepper" id="report-stepper" style="display:none">\n        <button type="button" class="tq-toolbar-arrow" data-action="stepStudent" data-dir="-1" title="Previous student" aria-label="Previous student"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>\n        <button type="button" class="tq-toolbar-arrow" data-action="stepStudent" data-dir="1" title="Next student" aria-label="Next student"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>\n      </div>\n      <div class="student-picker" id="student-picker">\n        <button class="student-picker-btn" data-action="toggleStudentPicker" aria-label="Select students" aria-expanded="false" aria-haspopup="listbox">\n          <span id="picker-label">All Students</span>\n        </button>\n        <div class="student-picker-dropdown" id="picker-dropdown"></div>\n      </div>\n      <select id="report-period" class="term-select" aria-label="Report" title="The report you are working on. Each report keeps its own comments and attendance."></select>\n      <select id="report-copy" class="term-select" aria-label="Copy" style="display:none"></select>\n      <div style="margin-left:auto;display:flex;align-items:center;gap:8px">\n        <span class="qn-ready tq-only" id="tq-ready" style="display:none"></span>\n        <button type="button" class="tb-icon-btn tq-only" id="tq-edit-student-btn" style="display:none" data-action="tqEditStudent" aria-label="Edit Student" title="Edit Student: name, pronouns, designations and contacts"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="7.5" r="3.5"></circle><path d="M2.5 19 c0.6-3.6 3.3-5.5 6.5-5.5 c1.2 0 2.3 0.25 3.2 0.75"></path><path d="M14.2 19.3 l0.4-2.3 l4.6-4.6 a1.35 1.35 0 0 1 1.9 1.9 l-4.6 4.6 z"></path></svg></button>\n        <button type="button" class="tb-icon-btn tq-only" id="tq-info-btn" style="display:none" data-action="tqInfo" aria-haspopup="dialog" aria-label="Where this information comes from" title="Where this information comes from"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="11" cy="11" r="9.25"></circle><path d="M8.4 8.6 a2.7 2.7 0 1 1 3.6 2.5 c-0.6 0.25 -1 0.8 -1 1.5 v0.6" stroke-linecap="round"></path><circle cx="11" cy="15.6" r="0.6" fill="currentColor"></circle></svg></button>\n        <button type="button" class="tb-action-btn tq-only" id="tq-approve-next" style="display:none" data-action="tqApproveNext" title="Saves this comment to the report card and opens the next student. \u2318 Return">Approve and Next \u203A</button>\n        <button class="tb-toggle-btn" id="tb-save-template" style="display:none" data-action="openSaveTemplate">Save as Template</button>\n        <button class="tb-toggle-btn" id="tb-phones-btn" style="display:none" data-action="togglePhones" aria-pressed="false">Sent to Phones</button>\n        <button class="tb-toggle-btn" id="tb-rail-btn" style="display:none" data-action="toggleRail" aria-pressed="false" aria-controls="studio-palette">Blocks</button>\n        <button class="tb-action-btn" id="tb-print-btn" data-action="printReports">Print Reports</button>\n      </div>\n    </div>\n    <div id="report-output" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto"></div>';

  /* -- Public API ----------------------------------------- */
  return {
    init: init,
    destroy: destroy,
    /* The data layer's redraw (_invalidateAndRerender) after the class's
       returned grades load: the page draws what it was waiting for. While
       nothing was waiting it does nothing, as before this page had a
       render(), so no other change of data redraws Reports. */
    render: function () {
      if (_waitingForReturns && document.getElementById('report-output')) renderReports();
    },
    // A redraw from elsewhere (Sent to Phones) only while the page is up.
    renderReports: function () {
      if (document.getElementById('report-output')) renderReports();
    },
    _helpers: {
      tabs: TABS,
      unknownTab: UNKNOWN_TAB,
      tabFor: _tabFor,
      tabIdFor: _tabIdFor,
      tabBarHtml: _tabBarHtml,
    },
  };
})();
