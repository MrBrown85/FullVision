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
    viewingIssue = null;
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
    const tbEdit = document.getElementById('tb-edit-layout-btn');
    if (tbEdit) tbEdit.style.display = tab === 'progress' && ReportBuilderUI.usesSheets(reportConfig) ? '' : 'none';
    if (tab !== 'progress') editLayout = false;
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
    if (viewingIssue && sheets) {
      _showIssue(viewingIssue.id);
      return;
    }
    Preview.renderReportPreview({
      cid: activeCourse,
      selectedStudentIds: _previewOverride() || selectedStudentIds,
      reportConfig: reportConfig,
      paper: reportPaper,
      onSheets: _rememberSummary,
    });
    _syncPrintButton();
    if (!sheets) _populateCopies();
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
    var ed = document.getElementById('tb-edit-layout-btn');
    if (ed) ed.style.display = activeTab === 'progress' && sheets ? '' : 'none';
    var banner = document.getElementById('rb-edit-banner');
    if (banner) banner.hidden = !(editLayout && sheets);
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

  /* ── Issued copies ───────────────────────────────────────────────
     Issue saves a fixed copy of every report (report-issues.js), then
     prints. The toolbar's copy picker shows the term's issues; choosing
     one shows and prints that copy instead of the live reports. */
  var _lastSummary = null;
  var viewingIssue = null; // the loaded copy while one is shown

  function _rememberSummary(summary) {
    // A Preview With pick shows one student; the class summary stays.
    if (!_previewOverride()) {
      _lastSummary = summary;
      _annotateSidebar(summary);
    }
    _populateCopies();
  }

  function _populateCopies() {
    var sel = document.getElementById('report-copy');
    if (!sel) return;
    var sheets = ReportBuilderUI.usesSheets(reportConfig) && activeTab === 'progress';
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
    ReportIssues.load(id).then(function (rec) {
      if (!rec) {
        viewingIssue = null;
        renderReports();
        return;
      }
      viewingIssue = rec;
      preview.innerHTML = rec.students
        .map(function (s) {
          return s.html;
        })
        .join('');
      preview.classList.add('report-sheets-on');
      preview.classList.remove('report-fitmap');
      preview.classList.toggle('report-photocopy', reportView === 'photocopy');
      ReportSheets.setPageStyle(rec.paper || 'letter');
      var line = document.getElementById('rb-form-summary');
      if (line)
        line.textContent =
          ReportIssues.label(rec) +
          ' · ' +
          rec.count +
          ' reports as they went home. Later score changes do not change this copy.';
      _syncPrintButton();
    });
  }

  function _syncPrintButton() {
    var btn = document.getElementById('tb-print-btn');
    if (!btn) return;
    var sheets = ReportBuilderUI.usesSheets(reportConfig) && activeTab === 'progress';
    if (viewingIssue) btn.textContent = 'Print This Copy';
    else if (sheets) btn.textContent = 'Issue Reports\u2026';
    else btn.textContent = 'Print Reports';
    var fm = document.getElementById('tb-fitmap-btn');
    if (fm && viewingIssue) fm.style.display = 'none';
  }

  function _printNow() {
    ensureClassFresh(activeCourse).then(function (fresh) {
      if (fresh || window.confirm("Couldn't confirm this class is up to date. Print the saved copy anyway?")) {
        window.print();
      }
    });
  }

  /* ── The Issue dialog ──────────────────────────────────────────── */
  var ISSUE_OVERLAY_ID = 'issue-overlay';
  var _issueState = null;

  function _issueCounts() {
    var s = _lastSummary || { perStudent: {}, continued: [], noComment: [] };
    var ids = Object.keys(s.perStudent || {});
    var sheets = 0;
    var hashes = {};
    ids.forEach(function (sid) {
      sheets += s.perStudent[sid].sheets;
      hashes[sid] = ReportIssues.hash(s.perStudent[sid].html);
    });
    var ctx = ReportBlocks.reportContext();
    var last = ReportIssues.latest(activeCourse, ctx.termId);
    var changed = last ? ReportIssues.changedSince(last, hashes) : ids;
    return { ids: ids, sheets: sheets, hashes: hashes, last: last, changed: changed, ctx: ctx, summary: s };
  }

  function _issueDialogHtml(c) {
    var course = COURSES[activeCourse] || {};
    var n = c.ids.length;
    var now = new Date();
    var stamp = now.toLocaleString('en-CA', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    var subtitle = [
      c.ctx.termLabel,
      course.name,
      typeof courseBlockLabel === 'function' ? courseBlockLabel(course) : '',
    ]
      .filter(Boolean)
      .map(esc)
      .join(' \u00B7 ');
    var onOne = n - c.summary.continued.length;
    var sheetsLine = c.sheets + (c.sheets === 1 ? ' sheet' : ' sheets') + ' \u00B7 ' + onOne + ' on one';
    if (c.summary.continued.length)
      sheetsLine += ', ' + c.summary.continued.length + ' on two (' + esc(c.summary.continued.join(', ')) + ')';
    var html = '<div class="confirm-card issue-card">';
    html += '<div class="confirm-title" id="issue-title">Issue ' + n + (n === 1 ? ' Report' : ' Reports') + '</div>';
    html += '<div class="confirm-message">' + subtitle + '</div>';
    html += '<div class="issue-kv">';
    html +=
      '<span class="issue-k">Saved as</span><span><b>' +
      esc(c.ctx.termLabel) +
      ' \u00B7 Issued ' +
      esc(stamp) +
      '</b><br><span class="issue-help">A fixed copy of every report. Reprints use this copy, not later scores.</span></span>';
    html +=
      '<span class="issue-k">Form</span><span>Report Card \u00B7 ' +
      (reportPaper === 'legal' ? 'Legal' : 'Letter') +
      ' \u00B7 front and back \u00B7 black and white</span>';
    html += '<span class="issue-k">Sheets</span><span>' + sheetsLine + '</span>';
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
        '><span>Changed since the last issue <span class="issue-help">(' +
        esc(ReportIssues.label(c.last).replace(/^Issued /, '')) +
        ' \u00B7 ' +
        c.changed.length +
        (c.changed.length === 1 ? ' student' : ' students') +
        ')</span></span></label>';
    }
    html += '</fieldset>';
    var warn = [];
    if (c.summary.noComment.length) {
      warn.push(
        esc(c.summary.noComment.join(', ')) +
          (c.summary.noComment.length === 1 ? ' has' : ' have') +
          ' no Teacher Comment. The box prints with lines. <a href="#" data-issue="write">Write them now</a>',
      );
    }
    if (c.summary.continued.length) {
      warn.push(
        esc(c.summary.continued.join(', ')) +
          (c.summary.continued.length === 1 ? ' needs' : ' need') +
          ' a second sheet.',
      );
    }
    if (warn.length) {
      html +=
        '<div class="issue-warn"><b>Before you issue</b>' +
        warn
          .map(function (w) {
            return '<div>' + w + '</div>';
          })
          .join('') +
        '</div>';
    }
    html += '<fieldset class="issue-group"><legend>Then</legend>';
    html +=
      '<label class="issue-option"><input type="checkbox" id="issue-print" checked><span>Print <span class="issue-help">\u00B7 set the copier to ' +
      (reportPaper === 'legal' ? 'Legal' : 'Letter') +
      ', 2-sided, flip on long edge</span></span></label>';
    html += '</fieldset>';
    html +=
      '<div class="confirm-actions"><button type="button" class="confirm-cancel" data-issue="cancel">Cancel</button>';
    html += '<button type="button" class="confirm-ok primary" data-issue="go">Issue and Print</button></div>';
    html += '</div>';
    return html;
  }

  function openIssueDialog() {
    closeIssueDialog();
    if (!_lastSummary || !Object.keys(_lastSummary.perStudent || {}).length) return;
    var c = _issueCounts();
    _issueState = { counts: c, trigger: document.activeElement };
    var overlay = document.createElement('div');
    overlay.id = ISSUE_OVERLAY_ID;
    overlay.className = 'confirm-overlay issue-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'issue-title');
    overlay.innerHTML = _issueDialogHtml(c);
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
      else if (a.dataset.issue === 'write') {
        var names = c.summary.noComment;
        var first = Object.keys(c.summary.perStudent).find(function (sid) {
          return c.summary.perStudent[sid].noComment;
        });
        closeIssueDialog();
        if (first) {
          tqSelectStudent(first);
          switchTab('questionnaire');
        }
      }
    });
    overlay.addEventListener('change', function () {
      var go = overlay.querySelector('[data-issue="go"]');
      var print = overlay.querySelector('#issue-print');
      if (go && print) go.textContent = print.checked ? 'Issue and Print' : 'Issue';
    });
    _issueState.keyHandler = function (e) {
      if (e.key === 'Escape') closeIssueDialog();
    };
    document.addEventListener('keydown', _issueState.keyHandler);
    document.body.appendChild(overlay);
    var first = overlay.querySelector('input');
    if (first && first.focus) first.focus();
  }

  function closeIssueDialog() {
    var overlay = document.getElementById(ISSUE_OVERLAY_ID);
    if (overlay && overlay.remove) overlay.remove();
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

  function _issueFromDialog(overlay) {
    var c = _issueState && _issueState.counts;
    if (!c) return;
    var who = (overlay.querySelector('input[name="issue-who"]:checked') || {}).value || 'all';
    var doPrint = !!(overlay.querySelector('#issue-print') || {}).checked;
    closeIssueDialog();
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
      students: students,
    }).then(function (res) {
      _populateCopies();
      var line = document.getElementById('rb-form-summary');
      if (line) {
        line.textContent =
          ReportIssues.label(res.entry) +
          ' \u00B7 ' +
          students.length +
          (students.length === 1 ? ' report' : ' reports') +
          (res.stored ? ' saved as a fixed copy.' : ' issued; this browser could not keep the copy.');
      }
      if (doPrint) _printNow();
    });
  }

  /* ── Fit Map: every student's sheets at a glance ─────────────── */
  var fitMapOn = false;
  function toggleFitMap(on) {
    fitMapOn = on === undefined ? !fitMapOn : !!on;
    renderReportPreview();
  }

  /* ── Edit Layout ──────────────────────────────────────────────────
     A mode, entered on purpose, for changing the class's form. Each
     change is saved with the report config and the sheets re-lay at once. */
  var editLayout = false;

  function setEditLayout(on) {
    editLayout = !!on && ReportBuilderUI.usesSheets(reportConfig);
    if (!editLayout) _previewPick = '';
    var banner = document.getElementById('rb-edit-banner');
    if (banner) banner.hidden = !editLayout;
    var btn = document.getElementById('tb-edit-layout-btn');
    if (btn) {
      btn.textContent = editLayout ? 'Done' : 'Edit Layout';
      btn.classList.toggle('active', editLayout);
      btn.setAttribute('aria-pressed', editLayout ? 'true' : 'false');
    }
    var preview = document.getElementById('rb-preview');
    if (preview) preview.classList.toggle('report-editing', editLayout);
    renderBuilderBlocks();
    renderReportPreview();
  }

  function _setForm(form) {
    reportConfig.form = ReportSheets.normalizeForm(form);
    saveReportConfig(activeCourse, reportConfig);
    renderBuilderBlocks();
    renderReportPreview();
    updateCommentFit();
  }

  function _formOf() {
    return ReportSheets.formFor(reportConfig);
  }
  function _labelAt(f, side, idx) {
    var it = (side === 'back' ? f.back : f.front)[idx];
    if (!it) return 'The block';
    return it.pair
      ? it.pair
          .map(function (q) {
            return q.label;
          })
          .join(' and ')
      : it.label;
  }
  function _keyOf(f, side, idx) {
    var it = (side === 'back' ? f.back : f.front)[idx];
    if (!it) return '';
    return it.pair
      ? it.pair
          .map(function (q) {
            return q.block;
          })
          .join('+')
      : it.block;
  }
  function _focusGrip(key) {
    var grip = document.querySelector('.rb-form-block[data-key="' + key + '"] .rb-form-grip');
    if (grip) grip.focus();
  }

  /* Arrow keys on a grip move the block; the live region says where it went. */
  function _handleGripKey(e) {
    var grip = e.target && e.target.closest ? e.target.closest('.rb-form-grip') : null;
    if (!grip || !editLayout) return;
    var side = grip.dataset.side;
    var idx = Number(grip.dataset.idx);
    var f = _formOf();
    var key = _keyOf(f, side, idx);
    var label = _labelAt(f, side, idx);
    var next = null;
    var where = '';
    if (e.key === 'ArrowUp') {
      next = ReportSheets.moveItem(f, side, idx, -1);
      where = 'up';
    } else if (e.key === 'ArrowDown') {
      next = ReportSheets.moveItem(f, side, idx, 1);
      where = 'down';
    } else if (e.key === 'ArrowLeft' && side === 'back') {
      next = ReportSheets.moveToSide(f, side, idx);
      where = 'to the front';
    } else if (e.key === 'ArrowRight' && side === 'front') {
      next = ReportSheets.moveToSide(f, side, idx);
      where = 'to the back';
    }
    if (!next) return;
    e.preventDefault();
    if (JSON.stringify(next) === JSON.stringify(f)) {
      _announce(label + ' cannot move ' + where + '.');
      return;
    }
    _setForm(next);
    var list = where === 'to the back' ? 'back' : where === 'to the front' ? 'front' : side;
    var at = (list === 'back' ? next.back : next.front).findIndex(function (it) {
      return (
        (it.pair
          ? it.pair
              .map(function (q) {
                return q.block;
              })
              .join('+')
          : it.block) === key
      );
    });
    _announce(
      label +
        ' moved ' +
        where +
        ': position ' +
        (at + 1) +
        ' of ' +
        (list === 'back' ? next.back : next.front).length +
        ' on the ' +
        list +
        '.',
    );
    _focusGrip(key);
  }

  /* Preview With: the longest, a typical and the shortest student in the
     class, by how much of the form their content fills. */
  var _previewPick = '';
  function _previewWith() {
    var s = _lastSummary && _lastSummary.perStudent;
    if (!s) return null;
    var rows = Object.keys(s)
      .map(function (sid) {
        return { sid: sid, name: s[sid].name, used: s[sid].used || 0 };
      })
      .sort(function (a, b) {
        return b.used - a.used;
      });
    if (rows.length < 2) return null;
    return { longest: rows[0], typical: rows[Math.floor(rows.length / 2)], shortest: rows[rows.length - 1] };
  }
  function _previewOverride() {
    if (!editLayout || !_previewPick) return null;
    var pw = _previewWith();
    return pw && pw[_previewPick] ? [pw[_previewPick].sid] : null;
  }

  function _announce(text) {
    var live = document.getElementById('rb-live');
    if (live) live.textContent = text;
  }

  function renderBuilderBlocks() {
    const container = document.getElementById('rb-blocks');
    if (!container) return;
    container.innerHTML = Builder.renderBuilderBlocks(reportConfig, editLayout, {
      previewWith: _previewWith(),
      pick: _previewPick,
    });
    if (editLayout) {
      Builder.initFormDrag(container, {
        onReorder: function (side, from, to) {
          var f = _formOf();
          var label = _labelAt(f, side, from);
          _setForm(ReportSheets.reorder(f, side, from, to));
          _announce(label + ' moved to position ' + (to + 1) + ' on the ' + side + '.');
        },
        onCancel: renderBuilderBlocks,
      });
    }
    if (!editLayout) return;
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
    viewingIssue = null;
    editLayout = false;
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
    viewingIssue = null;
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
        // A chosen copy prints as it is. The Report Card issues first, then
        // prints. Other presets print what the server has.
        if (viewingIssue) window.print();
        else if (ReportBuilderUI.usesSheets(reportConfig) && activeTab === 'progress') openIssueDialog();
        else _printNow();
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
      toggleEditLayout: function () {
        setEditLayout(!editLayout);
      },
      rbFormMove: function () {
        _setForm(ReportSheets.moveItem(_formOf(), el.dataset.side, Number(el.dataset.idx), Number(el.dataset.dir)));
      },
      rbFormSide: function () {
        _setForm(ReportSheets.moveToSide(_formOf(), el.dataset.side, Number(el.dataset.idx)));
      },
      rbFormRemove: function () {
        _setForm(ReportSheets.removeItem(_formOf(), el.dataset.side, Number(el.dataset.idx)));
      },
      rbFormType: function () {
        _setForm(ReportSheets.setType(_formOf(), el.dataset.type));
      },
      rbFormReset: function () {
        _setForm(ReportSheets.form());
      },
      rbFormPair: function () {
        _setForm(ReportSheets.pairWith(_formOf(), el.dataset.side, Number(el.dataset.idx)));
      },
      rbFormUnpair: function () {
        _setForm(ReportSheets.unpair(_formOf(), el.dataset.side, Number(el.dataset.idx)));
      },
      rbFormPreviewWith: function () {
        _previewPick = el.dataset.pick || '';
        renderBuilderBlocks();
        renderReportPreview();
      },
      rbFormStarter: function () {
        var f = ReportSheets.starter(el.dataset.starter);
        if (f) _setForm(f);
      },
      rbFormApplyTemplate: function () {
        var f = ReportSheets.template(el.dataset.id);
        if (f) _setForm(f);
      },
      rbFormDeleteTemplate: function () {
        ReportSheets.removeTemplate(el.dataset.id);
        renderBuilderBlocks();
      },
      rbFormGrip: function () {
        /* the grip is for dragging and the arrow keys; a click does nothing */
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

  function _handleFormSubmit(e) {
    var form = e.target && e.target.closest ? e.target.closest('form[data-action="rbFormSaveTemplate"]') : null;
    if (!form) return;
    e.preventDefault();
    var input = document.getElementById('rb-template-name');
    var entry = ReportSheets.saveTemplate(input ? input.value : '', _formOf());
    if (!entry) {
      if (input) input.focus();
      return;
    }
    renderBuilderBlocks();
    _announce('Saved ' + entry.name + ' to your library.');
  }

  function _handleFormChange(e) {
    var el = e.target;
    if (!el || !el.dataset || !el.closest('#rb-blocks')) return;
    var action = el.dataset.action;
    if (action === 'rbFormRoom') _setForm(ReportSheets.setRoom(_formOf(), el.value));
    else if (action === 'rbFormEmpty') _setForm(ReportSheets.setWhenEmpty(_formOf(), el.dataset.block, el.value));
    else if (action === 'rbFormPin') _setForm(ReportSheets.setPinned(_formOf(), el.dataset.block, el.checked));
    else if (action === 'rbFormAdd' && el.value) _setForm(ReportSheets.addBlock(_formOf(), el.value, 'front'));
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
    var r = ReportSheets.describeStudent(activeCourse, student, ctx, { paper: reportPaper, form: _formOf() });
    text.textContent = ReportSheets.fitText(r);
    line.classList.toggle('over', r.commentLines > r.room);
    line.hidden = !text.textContent;
  }

  function _handleKeyup(e) {
    var editor = document.getElementById('tq-narrative');
    if (editor && editor.contains(e.target)) tqUpdateToolbar();
  }

  function _handleReportPeriodChange() {
    viewingIssue = null;
    renderReports();
  }

  function _handleCopyChange(e) {
    _showIssue(e.target.value);
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
    var copyEl = document.getElementById('report-copy');
    if (copyEl) copyEl.addEventListener('change', _handleCopyChange);

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
    _addDocListener('change', _handleFormChange);
    _addDocListener('submit', _handleFormSubmit);
    _addDocListener('keydown', _handleGripKey);
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
    var copyEl = document.getElementById('report-copy');
    if (copyEl) copyEl.removeEventListener('change', _handleCopyChange);
    closeIssueDialog();
    viewingIssue = null;
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
    '<div class="report-toolbar no-print">\n      <div class="seg report-seg-control" role="tablist" aria-label="Report type">\n        <button class="seg-btn report-seg-btn active" data-action="switchTab" data-tab="questionnaire" role="tab" aria-selected="true">Term Questionnaire</button>\n        <button class="seg-btn report-seg-btn" data-action="switchTab" data-tab="progress" role="tab" aria-selected="false">Progress Reports</button>\n        <button class="seg-btn report-seg-btn" data-action="switchTab" data-tab="summary" role="tab" aria-selected="false">Class Summary</button>\n      </div>\n      <div class="student-picker" id="student-picker">\n        <button class="student-picker-btn" data-action="toggleStudentPicker" aria-label="Select students" aria-expanded="false" aria-haspopup="listbox">\n          <span id="picker-label">All Students</span>\n          <span class="arrow" aria-hidden="true">\u25bc</span>\n        </button>\n        <div class="student-picker-dropdown" id="picker-dropdown"></div>\n      </div>\n      <div class="tq-student-nav" id="tq-student-nav" style="display:none">\n        <button class="tq-toolbar-arrow" data-action="tqPrevStudent" title="Previous student" aria-label="Previous student">\n          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>\n        </button>\n        <span class="tq-student-name" id="tq-student-name"></span>\n        <button class="tq-toolbar-arrow" data-action="tqNextStudent" title="Next student" aria-label="Next student">\n          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>\n        </button>\n        <div class="tq-progress-ring" id="tq-progress-ring">\n          <svg width="30" height="30" viewBox="0 0 30 30">\n            <circle class="ring-bg" cx="15" cy="15" r="12"/>\n            <circle class="ring-fill" id="tq-ring-fill" cx="15" cy="15" r="12" stroke-dasharray="75.4" stroke-dashoffset="75.4"/>\n          </svg>\n          <span class="tq-progress-label" id="tq-progress-label"></span>\n        </div>\n      </div>\n      <select id="report-period" class="report-term-select" aria-label="Report"></select>\n      <select id="report-copy" class="report-term-select" aria-label="Copy" style="display:none"></select>\n      <div class="seg seg-sm" id="report-paper" role="radiogroup" aria-label="Paper" style="display:none">\n        <button class="seg-btn active" data-action="setPaper" data-paper="letter" role="radio" aria-checked="true">Letter</button>\n        <button class="seg-btn" data-action="setPaper" data-paper="legal" role="radio" aria-checked="false">Legal</button>\n      </div>\n      <div class="seg seg-sm" id="report-view" role="radiogroup" aria-label="View" style="display:none">\n        <button class="seg-btn active" data-action="setView" data-view="screen" role="radio" aria-checked="true">Screen</button>\n        <button class="seg-btn" data-action="setView" data-view="photocopy" role="radio" aria-checked="false">Photocopy</button>\n      </div>\n      <div style="margin-left:auto;display:flex;align-items:center;gap:8px">\n        <button class="tb-toggle-btn" id="tb-anon-btn" style="display:none" data-action="toggleAnon">\n          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>\n          Anonymize\n        </button>\n        <button class="tb-toggle-btn" id="tb-edit-layout-btn" style="display:none" data-action="toggleEditLayout" aria-pressed="false">Edit Layout</button>\n        <button class="tb-toggle-btn" id="tb-fitmap-btn" style="display:none" data-action="toggleFitMap" aria-pressed="false">Fit Map</button>\n        <button class="tb-action-btn" id="tb-print-btn" data-action="printReports">Print Reports</button>\n      </div>\n    </div>\n    <div id="report-output" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto"></div>';

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
