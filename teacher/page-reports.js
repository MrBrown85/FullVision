/* == page-reports.js -- Reports page module ================ */
window.PageReports = (function () {
  'use strict';

  /* -- Listener tracking for cleanup ---------------------- */
  var _listeners = [];
  function _addDocListener(type, handler, options) {
    document.addEventListener(type, handler, options);
    _listeners.push({ type: type, handler: handler, options: options });
  }

  var _beforeUnloadHandler = null;
  var Builder = ReportBuilderUI;
  var Preview = ReportPreview;

  /* ══════════════════════════════════════════════════════════════
   REPORTS PAGE — Logic
   ══════════════════════════════════════════════════════════════ */

  var activeCourse;
  var activeTab = 'questionnaire';

  /* ══════════════════════════════════════════════════════════════
   REPORT BUILDER — Config, presets, persistence
   ══════════════════════════════════════════════════════════════ */
  var reportConfig = null;

  /* ── Block renderers + helpers now in report-blocks.js ────── */
  var getPronouns = ReportBlocks.getPronouns;
  var OBS_DESCRIPTORS = ReportBlocks.OBS_DESCRIPTORS;
  var getTermId = ReportBlocks.getTermId;
  var renderReportBlock = ReportBlocks.renderReportBlock;

  /* ── Paper ───────────────────────────────────────────────────────
     Letter or Legal for the printed reports, remembered per class on this
     device. reports.css fixes @page to Letter; a Legal choice appends a
     style element that overrides it, the way rubric-print.js does for its
     layouts. DECISIONS.md, "Report forms" 4. */
  var PAPER_STYLE_ID = 'report-paper-style';
  var PAPER_SIZES = { letter: '8.5in 11in', legal: '8.5in 14in' };
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
    var sheets = typeof ReportBuilderUI !== 'undefined' && ReportBuilderUI.usesSheets(reportConfig);
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

  /* ── View: Screen or Photocopy ──────────────────────────────────
     Photocopy shows the sheets as the copier prints them: black levels,
     no tints. A view, not a setting; it is not remembered. */
  var reportView = 'screen';
  function setView(view) {
    reportView = view === 'photocopy' ? 'photocopy' : 'screen';
    var preview = document.getElementById('rb-preview');
    if (preview) preview.classList.toggle('report-photocopy', reportView === 'photocopy');
    document.querySelectorAll('#report-view .seg-btn').forEach(function (b) {
      var on = b.dataset.view === reportView;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  /* ── Class Summary ───────────────────────────────────────────── */
  var classSummaryAnon = false;
  var tqIncludeAssignFeedback = true;
  var tqObsFilter = 'all'; // 'all'|'general'|'assignment'

  /* ── Tab switching ───────────────────────────────────────────── */
  function switchTab(tab) {
    activeTab = tab;
    segSelect(document.querySelector('.report-seg-btn[data-tab="' + tab + '"]'));
    // Show/hide contextual toolbar elements
    document.getElementById('student-picker').style.display = tab === 'progress' ? '' : 'none';
    document.getElementById('tq-student-nav').style.display = tab === 'questionnaire' ? 'flex' : 'none';
    // Show Print button only on progress reports and class summary
    const tbPrint = document.getElementById('tb-print-btn');
    if (tbPrint) tbPrint.style.display = tab === 'questionnaire' ? 'none' : '';
    const tbPaper = document.getElementById('report-paper');
    if (tbPaper) tbPaper.style.display = tab === 'questionnaire' ? 'none' : '';
    const tbView = document.getElementById('report-view');
    if (tbView) tbView.style.display = tab === 'progress' ? '' : 'none';
    const tbFit = document.getElementById('tb-fitmap-btn');
    if (tbFit) tbFit.style.display = tab === 'progress' && ReportBuilderUI.usesSheets(reportConfig) ? '' : 'none';
    if (tab !== 'progress') _restoreSidebarBadges();
    // Show Anonymize button only on class summary
    const tbAnon = document.getElementById('tb-anon-btn');
    if (tbAnon) tbAnon.style.display = tab === 'summary' ? '' : 'none';
    renderReports();
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
    if (activeTab === 'questionnaire') {
      if (typeof setLongFormAuthContext === 'function') {
        setLongFormAuthContext({
          kind: 'term-rating',
          getDraftText: function () {
            var editor = document.getElementById('tq-narrative');
            return editor ? editor.innerText || editor.textContent || '' : '';
          },
        });
      }
      return;
    }
    if (typeof clearLongFormAuthContext === 'function') {
      clearLongFormAuthContext('term-rating');
    }
  }

  /* ── Main render ─────────────────────────────────────────────── */
  /* A report for Report N shows the grades of reporting term N when the
     class has one (docs/DECISIONS.md, "Reporting periods"); otherwise all
     time. This never changes the term chosen on the other pages. */
  function _applyReportTerm() {
    if (typeof setActiveTerm !== 'function') return;
    const cid = activeCourse;
    const period = (document.getElementById('report-period')?.value || '').match(/Report\s+(\d+)/i);
    const n = period ? Number(period[1]) : null;
    const has =
      n != null &&
      typeof getReportingTerms === 'function' &&
      getReportingTerms(cid).some(function (t) {
        return t.ordinal === n;
      });
    setActiveTerm(cid, has ? n : null);
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

  function renderReports() {
    const cid = activeCourse;
    const output = document.getElementById('report-output');
    _applyReportTerm();

    if (activeTab === 'summary') {
      _syncLongFormAuthContext();
      output.innerHTML = Preview.renderClassSummary(cid, classSummaryAnon);
      return;
    }

    if (activeTab === 'questionnaire') {
      output.innerHTML = renderTermQuestionnaire(cid);
      _syncLongFormAuthContext();
      updateCommentFit();
      // Highlight active student in sidebar
      const students = getTqStudents();
      const activeSid = students[RQ.tqStudentIndex]?.id;
      document.querySelectorAll('#gb-sidebar .student-row').forEach(row => {
        const href = row.getAttribute('href') || '';
        const match = href.match(/id=([^&]+)/);
        row.classList.toggle('selected', match && match[1] === activeSid);
      });
      return;
    }

    _syncLongFormAuthContext();

    // Progress reports — render two-panel builder layout
    output.innerHTML = Builder.renderLayout(reportConfig);

    renderBuilderBlocks();
    renderReportPreview();

    // Highlight selected students in sidebar for progress tab
    if (selectedStudentIds && selectedStudentIds.length > 0) {
      document.querySelectorAll('#gb-sidebar .student-row').forEach(row => {
        const href = row.getAttribute('href') || '';
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
  function renderReportPreview() {
    var sheets = ReportBuilderUI.usesSheets(reportConfig);
    Preview.renderReportPreview({
      cid: activeCourse,
      selectedStudentIds: selectedStudentIds,
      reportConfig: reportConfig,
      paper: reportPaper,
      onSheets: _annotateSidebar,
    });
    var preview = document.getElementById('rb-preview');
    if (preview) {
      preview.classList.toggle('report-photocopy', reportView === 'photocopy');
      preview.classList.toggle('report-fitmap', sheets && fitMapOn);
    }
    var fm = document.getElementById('tb-fitmap-btn');
    if (fm) {
      fm.style.display = activeTab === 'progress' && sheets ? '' : 'none';
      fm.classList.toggle('active', fitMapOn);
      fm.setAttribute('aria-pressed', fitMapOn ? 'true' : 'false');
    }
    if (!sheets) _restoreSidebarBadges();
  }

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
      var cls = info.sheets > 1 ? 'over' : info.noComment ? 'none' : 'ok';
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
        cell.innerHTML = cell.dataset.gradesHtml;
        delete cell.dataset.gradesHtml;
      }
    });
    _sidebarAnnotated = false;
  }

  /* ── Fit Map: every student's sheets at a glance ─────────────── */
  var fitMapOn = false;
  function toggleFitMap(on) {
    fitMapOn = on === undefined ? !fitMapOn : !!on;
    renderReportPreview();
  }

  function renderBuilderBlocks() {
    const container = document.getElementById('rb-blocks');
    if (!container) return;
    container.innerHTML = Builder.renderBuilderBlocks(reportConfig);
    Builder.initPointerDrag(container, {
      onReorder: function (startIdx, finalIdx) {
        var moved = reportConfig.blocks.splice(startIdx, 1)[0];
        reportConfig.blocks.splice(finalIdx, 0, moved);
        reportConfig.preset = 'custom';
        saveReportConfig(activeCourse, reportConfig);
        renderBuilderBlocks();
        renderReportPreview();
        Builder.updatePresetBtns(reportConfig);
      },
      onCancel: function () {
        renderBuilderBlocks();
      },
    });
  }

  function rbToggleBlock(blockId) {
    Builder.toggleBlock(reportConfig, blockId);
    saveReportConfig(activeCourse, reportConfig);
    renderBuilderBlocks();
    renderReportPreview();
    Builder.updatePresetBtns(reportConfig);
  }

  function rbApplyPreset(preset) {
    Builder.applyPreset(reportConfig, preset);
    saveReportConfig(activeCourse, reportConfig);
    renderBuilderBlocks();
    renderReportPreview();
    Builder.updatePresetBtns(reportConfig);
  }

  function rbUpdatePresetBtns() {
    Builder.updatePresetBtns(reportConfig);
  }

  /* ── Pointer-based drag-and-drop reorder ── */
  // Legacy stubs (no longer used but kept for safety in case inline attrs remain)
  function rbDragStart() {}
  function rbDragEnd() {}
  function rbDragOver() {}
  function rbDragLeave() {}
  function rbDrop() {}

  /* ── Course switching ────────────────────────────────────────── */
  async function switchCourse(cid) {
    activeCourse = cid;
    if (!(await switchActiveCourse(cid))) return;
    selectedStudentIds = null; // reset to all
    reportPaper = _loadPaper(cid);
    _applyPaper();
    reportConfig = Builder.getReportConfigWrapped(cid);
    _configureQuestionnaire();
    populateStudentSelect();
    populateReportPeriods(false);
    renderReports();
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
  function tqExec(cmd) {
    RQ.tqExec(cmd);
  }
  function tqUpdateToolbar() {
    RQ.tqUpdateToolbar();
  }
  function tqCopyNarrative() {
    RQ.tqCopyNarrative();
  }
  function tqSetDim(sid, dim, val) {
    RQ.tqSetDim(sid, dim, val);
  }
  function tqSetField(sid, field, val) {
    RQ.tqSetField(sid, field, val);
  }
  function tqToggleTrait(sid, tid) {
    RQ.tqToggleTrait(sid, tid);
  }
  function tqToggleAssignment(sid, aid) {
    RQ.tqToggleAssignment(sid, aid);
  }
  function tqToggleOb(sid, obId) {
    RQ.tqToggleOb(sid, obId);
  }
  function tqAutoNarrative(sid) {
    RQ.tqAutoNarrative(sid);
  }
  function tqSelectStudent(sid) {
    RQ.tqSelectStudent(sid);
  }
  function renderTermQuestionnaire(cid) {
    return RQ.renderTermQuestionnaire(cid);
  }

  function _configureQuestionnaire() {
    RQ.configure({
      activeCourse: activeCourse,
      renderReports: renderReports,
      tqIncludeAssignFeedback: tqIncludeAssignFeedback,
      tqObsFilter: tqObsFilter,
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

    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.dataset.action;
    var handlers = {
      switchTab: function () {
        switchTab(el.dataset.tab);
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
      toggleAnon: function () {
        classSummaryAnon = !classSummaryAnon;
        el.classList.toggle('active', classSummaryAnon);
        renderReports();
      },
      printReports: function () {
        // Print what the server has, not a saved copy it may have replaced.
        ensureClassFresh(activeCourse).then(function (fresh) {
          if (fresh || window.confirm("Couldn't confirm this class is up to date. Print the saved copy anyway?")) {
            window.print();
          }
        });
      },
      setPaper: function () {
        setPaper(el.dataset.paper);
      },
      setView: function () {
        setView(el.dataset.view);
      },
      toggleFitMap: function () {
        toggleFitMap();
      },
      tqSeePage: function () {
        tqSaveCurrentIfNeeded();
        selectedStudentIds = [el.dataset.sid];
        populateStudentSelect();
        switchTab('progress');
      },
      fitMapPick: function () {
        // A thumbnail opens that student's pages. Outside the Fit Map the
        // sheets are ordinary content and a click means nothing.
        if (!fitMapOn) return;
        selectedStudentIds = [el.dataset.sid];
        fitMapOn = false;
        populateStudentSelect();
        renderReports();
      },
      rbApplyPreset: function () {
        rbApplyPreset(el.dataset.preset);
      },
      rbToggleBlock: function () {
        e.stopPropagation();
        rbToggleBlock(el.dataset.blockid);
      },
      summaryStudentClick: function () {
        e.preventDefault();
        tqSelectStudent(el.dataset.sid);
        switchTab('questionnaire');
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
      tqSetDim: function () {
        tqSetDim(el.dataset.sid, el.dataset.dim, parseInt(el.dataset.lvl, 10));
      },
      tqSetField: function () {
        tqSetField(el.dataset.sid, el.dataset.field, parseInt(el.dataset.lvl, 10));
      },
      tqToggleTrait: function () {
        tqToggleTrait(el.dataset.sid, el.dataset.tid);
      },
      tqToggleAssignment: function () {
        tqToggleAssignment(el.dataset.sid, el.dataset.aid);
      },
      tqExec: function () {
        tqExec(el.dataset.cmd);
      },
      tqAutoNarrative: function () {
        tqAutoNarrative(el.dataset.sid);
      },
      tqCopyNarrative: function () {
        tqCopyNarrative();
      },
      tqObsFilter: function () {
        tqObsFilter = el.dataset.filter;
        RQ.tqObsFilter = el.dataset.filter;
        renderReports();
      },
      tqToggleOb: function () {
        tqToggleOb(el.dataset.sid, el.dataset.obid);
      },
    };
    if (handlers[action]) {
      handlers[action]();
    }
  }

  function _handleSelectionChange() {
    var editor = document.getElementById('tq-narrative');
    if (!editor) return;
    var sel = document.getSelection();
    if (sel && sel.anchorNode && editor.contains(sel.anchorNode)) tqUpdateToolbar();
  }

  // The CSP blocks inline on* attributes, so the narrative's dirty flag is set here.
  function _handleNarrativeInput(e) {
    if (e.target && e.target.id === 'tq-narrative') {
      RQ.tqNarrativeDirty = true;
      clearTimeout(_fitTimer);
      _fitTimer = setTimeout(updateCommentFit, 250);
    }
  }

  /* ── The comment box knows the form's room ─────────────────────
     Under the questionnaire's editor: how the draft sits on the Report
     Card's front, what it pushes, and a button to the student's pages. */
  var _fitTimer = null;
  function updateCommentFit() {
    var line = document.getElementById('tq-fit');
    var text = document.getElementById('tq-fit-text');
    if (!line || !text) return;
    if (!ReportBuilderUI.usesSheets(reportConfig) || typeof ReportSheets === 'undefined') {
      line.hidden = true;
      return;
    }
    var student = getTqStudents()[RQ.tqStudentIndex];
    var editor = document.getElementById('tq-narrative');
    if (!student || !editor) {
      line.hidden = true;
      return;
    }
    var ctx = ReportBlocks.reportContext();
    ctx.narrativeOverride = editor.innerHTML;
    var r = ReportSheets.describeStudent(activeCourse, student, ctx, { paper: reportPaper });
    text.textContent = ReportSheets.fitText(r);
    line.classList.toggle('over', r.commentLines > r.room);
    line.hidden = !text.textContent;
  }

  function _handleKeyup(e) {
    var editor = document.getElementById('tq-narrative');
    if (editor && editor.contains(e.target)) tqUpdateToolbar();
  }

  function _handleReportPeriodChange() {
    renderReports();
  }

  var _resizeTimer = null;
  function _handleResize() {
    if (activeTab !== 'progress' || !ReportBuilderUI.usesSheets(reportConfig)) return;
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(renderReportPreview, 150);
  }

  function _handleSidebarClick(e) {
    var row = e.target.closest('.student-row');
    if (!row) return;
    e.preventDefault();
    var href = row.getAttribute('href') || '';
    var match = href.match(/id=([^&]+)/);
    if (!match) return;
    var sid = match[1];
    if (activeTab === 'progress') {
      selectedStudentIds = [sid];
      populateStudentSelect();
      renderReports();
    } else if (activeTab === 'summary') {
      tqSelectStudent(sid);
      switchTab('questionnaire');
    } else {
      tqSelectStudent(sid);
    }
  }

  /* -- Late policy contenteditable handlers (replaces inline onblur/onfocus) -- */
  function _handleLatePolicyFocus(e) {
    var el = e.target;
    if (!el || el.dataset.action !== 'latePolicyEdit') return;
    var cid = activeCourse;
    if (!getCourseConfig(cid).lateWorkPolicy) {
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
    var c = getCourseConfig(cid);
    c.lateWorkPolicy = v;
    saveCourseConfig(cid, c);
    el.style.color = v ? 'var(--text-2)' : 'var(--text-3)';
    el.style.fontStyle = v ? 'normal' : 'italic';
    if (!v) el.textContent = 'No late work policy set';
  }

  /* -- init / destroy ------------------------------------- */
  function init(params) {
    activeCourse = params.course || getActiveCourse();
    setActiveCourse(activeCourse);
    activeTab = params.tab || 'questionnaire';
    selectedStudentIds = null;
    classSummaryAnon = false;
    tqIncludeAssignFeedback = true;
    tqObsFilter = 'all';

    reportConfig = Builder.getReportConfigWrapped(activeCourse);
    _configureQuestionnaire();
    RQ.tqStudentIndex = 0;
    RQ.tqNarrativeDirty = false;

    // Show sidebar
    document.getElementById('sidebar-mount').style.display = '';
    document.getElementById('page-layout').classList.remove('sidebar-hidden');
    document.getElementById('sidebar-mount').innerHTML = renderSidebar(activeCourse, null);
    initSidebarToggle();

    // Render the toolbar + output container into main
    document.getElementById('main').innerHTML = TOOLBAR_HTML;

    reportPaper = _loadPaper(activeCourse);
    _applyPaper();

    // Wire report-period change
    populateReportPeriods(false);
    var reportPeriodEl = document.getElementById('report-period');
    if (reportPeriodEl) reportPeriodEl.addEventListener('change', _handleReportPeriodChange);

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
    window.addEventListener('resize', _handleResize);
    _addDocListener('selectionchange', _handleSelectionChange);
    _addDocListener('keyup', _handleKeyup);
    _addDocListener('input', _handleNarrativeInput);
    _addDocListener('focusin', _handleLatePolicyFocus);
    _addDocListener('focusout', _handleLatePolicyBlur);
  }

  function destroy() {
    // Save any unsaved narrative
    if (RQ.tqNarrativeDirty) tqSaveCurrentIfNeeded();
    var paperStyle = document.getElementById(PAPER_STYLE_ID);
    if (paperStyle) paperStyle.remove();
    if (typeof ReportSheets !== 'undefined') ReportSheets.clearPageStyle();
    _restoreSidebarBadges();
    if (typeof clearLongFormAuthContext === 'function') clearLongFormAuthContext('term-rating');

    _listeners.forEach(function (l) {
      document.removeEventListener(l.type, l.handler, l.options);
    });
    _listeners = [];

    window.removeEventListener('resize', _handleResize);
    clearTimeout(_fitTimer);
    if (_beforeUnloadHandler) {
      window.removeEventListener('beforeunload', _beforeUnloadHandler);
      _beforeUnloadHandler = null;
    }

    // Clean up report-period and sidebar click listeners
    var reportPeriodEl = document.getElementById('report-period');
    if (reportPeriodEl) reportPeriodEl.removeEventListener('change', _handleReportPeriodChange);
    var sidebarEl = document.getElementById('sidebar-mount');
    if (sidebarEl) sidebarEl.removeEventListener('click', _handleSidebarClick);

    delete window._pageSwitchCourse;
    delete window.rbDragStart;
    delete window.rbDragEnd;
    delete window.rbDragOver;
    delete window.rbDragLeave;
    delete window.rbDrop;
  }

  /* -- Toolbar HTML (rendered into main on init) ---------- */
  var TOOLBAR_HTML =
    '<div class="report-toolbar no-print">\n      <div class="seg report-seg-control" role="tablist" aria-label="Report type">\n        <button class="seg-btn report-seg-btn active" data-action="switchTab" data-tab="questionnaire" role="tab" aria-selected="true">Term Questionnaire</button>\n        <button class="seg-btn report-seg-btn" data-action="switchTab" data-tab="progress" role="tab" aria-selected="false">Progress Reports</button>\n        <button class="seg-btn report-seg-btn" data-action="switchTab" data-tab="summary" role="tab" aria-selected="false">Class Summary</button>\n      </div>\n      <div class="student-picker" id="student-picker">\n        <button class="student-picker-btn" data-action="toggleStudentPicker" aria-label="Select students" aria-expanded="false" aria-haspopup="listbox">\n          <span id="picker-label">All Students</span>\n          <span class="arrow" aria-hidden="true">\u25bc</span>\n        </button>\n        <div class="student-picker-dropdown" id="picker-dropdown"></div>\n      </div>\n      <div class="tq-student-nav" id="tq-student-nav" style="display:none">\n        <button class="tq-toolbar-arrow" data-action="tqPrevStudent" title="Previous student" aria-label="Previous student">\n          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>\n        </button>\n        <span class="tq-student-name" id="tq-student-name"></span>\n        <button class="tq-toolbar-arrow" data-action="tqNextStudent" title="Next student" aria-label="Next student">\n          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>\n        </button>\n        <div class="tq-progress-ring" id="tq-progress-ring">\n          <svg width="30" height="30" viewBox="0 0 30 30">\n            <circle class="ring-bg" cx="15" cy="15" r="12"/>\n            <circle class="ring-fill" id="tq-ring-fill" cx="15" cy="15" r="12" stroke-dasharray="75.4" stroke-dashoffset="75.4"/>\n          </svg>\n          <span class="tq-progress-label" id="tq-progress-label"></span>\n        </div>\n      </div>\n      <select id="report-period" class="report-term-select" aria-label="Report"></select>\n      <div class="seg seg-sm" id="report-paper" role="radiogroup" aria-label="Paper" style="display:none">\n        <button class="seg-btn active" data-action="setPaper" data-paper="letter" role="radio" aria-checked="true">Letter</button>\n        <button class="seg-btn" data-action="setPaper" data-paper="legal" role="radio" aria-checked="false">Legal</button>\n      </div>\n      <div class="seg seg-sm" id="report-view" role="radiogroup" aria-label="View" style="display:none">\n        <button class="seg-btn active" data-action="setView" data-view="screen" role="radio" aria-checked="true">Screen</button>\n        <button class="seg-btn" data-action="setView" data-view="photocopy" role="radio" aria-checked="false">Photocopy</button>\n      </div>\n      <div style="margin-left:auto;display:flex;align-items:center;gap:8px">\n        <button class="tb-toggle-btn" id="tb-anon-btn" style="display:none" data-action="toggleAnon">\n          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>\n          Anonymize\n        </button>\n        <button class="tb-toggle-btn" id="tb-fitmap-btn" style="display:none" data-action="toggleFitMap" aria-pressed="false">Fit Map</button>\n        <button class="tb-action-btn" id="tb-print-btn" data-action="printReports">Print Reports</button>\n      </div>\n    </div>\n    <div id="report-output" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto"></div>';

  /* -- Expose handlers for inline event attributes --------- */
  window.rbDragStart = rbDragStart;
  window.rbDragEnd = rbDragEnd;
  window.rbDragOver = rbDragOver;
  window.rbDragLeave = rbDragLeave;
  window.rbDrop = rbDrop;

  /* -- Public API ----------------------------------------- */
  return {
    init: init,
    destroy: destroy,
    switchCourse: switchCourse,
  };
})();
