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

  /* ── View: Screen or Photocopy ──────────────────────────────────
     Photocopy shows the sheets as the copier prints them: black levels,
     no tints. A view, not a setting; it is not remembered. */
  function _syncInkButtons() {
    document.querySelectorAll('#report-ink .seg-btn').forEach(function (b) {
      var on = (b.dataset.ink === 'black') === (reportView === 'photocopy');
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }
  function _syncPagesButtons() {
    var pps = String(_formOf().pagesPerStudent);
    document.querySelectorAll('#report-pages .seg-btn').forEach(function (b) {
      var on = b.dataset.pages === pps;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  var reportView = 'screen';
  function setView(view) {
    reportView = view === 'photocopy' ? 'photocopy' : 'screen';
    var preview = document.getElementById('rb-preview');
    if (preview) preview.classList.toggle('report-photocopy', reportView === 'photocopy');
    _syncInkButtons();
  }

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
    ['report-pages', 'report-ink', 'tb-count', 'tb-divider', 'tb-paper-label'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.style.display = tab === 'progress' ? '' : 'none';
    });
    document.querySelectorAll('.tb-label-progress').forEach(function (el) {
      el.style.display = tab === 'progress' ? '' : 'none';
    });
    const copySel = document.getElementById('report-copy');
    if (copySel && tab !== 'progress') copySel.style.display = 'none';
    if (tab === 'progress') {
      _syncInkButtons();
      _syncPagesButtons();
    }
    const tbRail = document.getElementById('tb-rail-btn');
    if (tbRail) tbRail.style.display = tab === 'progress' ? '' : 'none';
    const stepper = document.getElementById('report-stepper');
    if (stepper) stepper.style.display = tab === 'progress' ? '' : 'none';
    if (tab !== 'progress') _restoreSidebarBadges();
    var layout = document.getElementById('page-layout');
    if (layout) layout.classList.toggle('sidebar-hidden', tab === 'progress' || !_sidebarVisible);
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

    // Progress Reports: Page Studio (report-studio.js)
    output.innerHTML = ReportStudio.layoutHtml({ view: studioView });
    renderStudioPanels();
    renderReportPreview();
    _mountStudioDrag();

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
  /* The students the canvas shows: everyone selected in Everyone view, one
     of them in One Student view (the previewed one, else the first). */
  function _previewStudents() {
    var all = sortStudents(getStudents(activeCourse), 'lastName');
    var chosen =
      selectedStudentIds === null
        ? all
        : all.filter(function (st) {
            return selectedStudentIds.includes(st.id);
          });
    if (studioView === 'all') return chosen;
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
    Preview.renderReportPreview({
      cid: activeCourse,
      students: _previewStudents(),
      reportConfig: reportConfig,
      paper: reportPaper,
      onSheets: _rememberSummary,
    });
    _syncPrintButton();
    var preview = document.getElementById('rb-preview');
    if (preview) {
      preview.classList.toggle('report-photocopy', reportView === 'photocopy');
      preview.classList.toggle('report-fitmap', studioView === 'all');
      preview.classList.toggle('studio-all', studioView === 'all');
      _applyStudioZoom(preview);
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
    var z = ReportStudio.fitZoom(preview.clientWidth || 800, reportPaper);
    preview.style.setProperty('--sheet-zoom', String(z.zoom));
    preview.classList.toggle('studio-stacked', !!z.stacked);
  }

  function _applySelection(preview) {
    preview.querySelectorAll('.sheet-cell.studio-sel').forEach(function (el) {
      el.classList.remove('studio-sel');
    });
    preview.querySelectorAll('.studio-handle').forEach(function (el) {
      el.remove();
    });
    preview.querySelectorAll('.sheet-cell[data-block]').forEach(function (el) {
      if (el.dataset.block !== 'header') el.setAttribute('tabindex', '0');
    });
    if (!studioSelected) return;
    var f = _formOf();
    var resizable = ReportSheets.spanChoices(f, studioSelected).length > 1;
    preview.querySelectorAll('.sheet-cell[data-block="' + studioSelected + '"]').forEach(function (el, i) {
      el.classList.add('studio-sel');
      if (resizable && i === 0) {
        var h = document.createElement('span');
        h.className = 'studio-handle';
        h.dataset.handle = studioSelected;
        h.setAttribute('aria-hidden', 'true');
        el.appendChild(h);
      }
    });
    if (_focusBlock) {
      var target = preview.querySelector('.sheet-cell[data-block="' + _focusBlock + '"]');
      _focusBlock = null;
      if (target) target.focus({ preventScroll: true });
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
    _lastSummary = summary;
    _annotateSidebar(summary);
    _populateCopies();
    if (studioView === 'all') {
      _classFit = summary;
      _classFitKey = _classFitKeyNow();
      _renderStudioStats();
    } else {
      _scheduleClassFit();
    }
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
      if (!rec) {
        viewingIssue = null;
        renderReports();
        return;
      }
      viewingIssue = rec;
      var shown = rec.students;
      if (studioView !== 'all') {
        var one = rec.students.find(function (st) {
          return st.sid === previewSid;
        });
        shown = one ? [one] : rec.students.slice(0, 1);
      }
      preview.innerHTML = shown
        .map(function (st) {
          return st.html;
        })
        .join('');
      preview.classList.add('report-sheets-on');
      preview.classList.toggle('report-fitmap', studioView === 'all');
      preview.classList.toggle('studio-all', studioView === 'all');
      preview.classList.toggle('report-photocopy', reportView === 'photocopy');
      ReportSheets.setPageStyle(rec.paper || 'letter');
      _applyStudioZoom(preview);
      _syncPrintButton();
    });
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
    var onOne = n - c.summary.continued.length;
    var studentsLine =
      n +
      (n === 1 ? ' student' : ' students') +
      ' \u00B7 ' +
      (c.summary.continued.length
        ? onOne + ' on 1 sheet, ' + c.summary.continued.length + ' on 2'
        : n === 1
          ? '1 sheet'
          : '1 sheet each');
    var form = ReportSheets.formFor(reportConfig);
    var html = '<div class="confirm-card issue-card">';
    html += '<div class="confirm-title" id="issue-title">Print ' + n + (n === 1 ? ' Report' : ' Reports') + '</div>';
    html += '<div class="confirm-message">' + subtitle + '</div>';
    html += '<div class="issue-kv">';
    html +=
      '<span class="issue-k">Form</span><span>' +
      esc(form.name) +
      ' \u00B7 ' +
      (reportPaper === 'legal' ? 'Legal' : 'Letter') +
      ' \u00B7 ' +
      (reportView === 'photocopy' ? 'black' : 'colour') +
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
    var warn = [];
    if (c.summary.noComment.length) {
      warn.push(
        esc(c.summary.noComment.join(', ')) +
          (c.summary.noComment.length === 1 ? ' has' : ' have') +
          ' no Teacher Comment. The box prints with lines. <a href="#" data-issue="write">Write them now</a>',
      );
    }
    if (c.summary.over && c.summary.over.length) {
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
    _issueState = { counts: c, trigger: document.activeElement };
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
    _issueState.keyHandler = function (e) {
      if (e.key === 'Escape') closeIssueDialog();
    };
    document.addEventListener('keydown', _issueState.keyHandler);
    document.body.appendChild(overlay);
    var first = overlay.querySelector('input');
    if (first && first.focus) first.focus();
  }

  function closeIssueDialog(keepEveryone) {
    var overlay = document.getElementById(ISSUE_OVERLAY_ID);
    if (overlay && overlay.remove) overlay.remove();
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

  function _issueFromDialog(overlay) {
    var c = _issueState && _issueState.counts;
    if (!c) return;
    var who = (overlay.querySelector('input[name="issue-who"]:checked') || {}).value || 'all';
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
      form: ReportSheets.normalizeForm(reportConfig.form),
      students: students,
    }).then(function (res) {
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
  var studioSelected = null; // the selected block id
  var studioTab = 'blocks'; // the palette's tab
  var _blockSizes = null; // palette badges, measured once per class/paper/type

  function _setForm(form) {
    reportConfig.form = ReportSheets.normalizeForm(form);
    saveReportConfig(activeCourse, reportConfig);
    if (studioSelected && !ReportSheets.locate(reportConfig.form, studioSelected)) studioSelected = null;
    _classFitKey = '';
    renderStudioPanels();
    renderReportPreview();
    updateCommentFit();
  }

  function _formOf() {
    return ReportSheets.formFor(reportConfig);
  }

  function _loadReportConfig(cid) {
    var rc = Object.assign({}, (typeof getReportConfig === 'function' && getReportConfig(cid)) || {});
    rc.form = ReportSheets.formFor(rc);
    rc.preset = 'standard';
    return rc;
  }

  function renderStudioPanels() {
    var palette = document.getElementById('studio-palette');
    if (palette) {
      if (_blockSizes === null) _blockSizes = _measureBlockSizes();
      palette.innerHTML = ReportStudio.paletteHtml(_formOf(), _blockSizes, studioTab, ReportSheets.templates());
    }
    _renderStudioStats();
  }

  function _renderStudioStats() {
    var insp = document.getElementById('studio-inspector');
    if (insp) insp.innerHTML = ReportStudio.inspectorHtml(_formOf(), studioSelected, ReportStudio.stats(_classFit));
    var count = document.getElementById('tb-count');
    if (count) count.textContent = ReportStudio.countText(_classFit);
  }

  function _measureBlockSizes() {
    try {
      var students = sortStudents(getStudents(activeCourse), 'lastName');
      var st = students[Math.floor(students.length / 2)];
      if (!st) return {};
      return ReportSheets.blockSizes(activeCourse, st, ReportBlocks.reportContext(), {
        paper: reportPaper,
        type: _formOf().type,
      });
    } catch (e) {
      return {};
    }
  }

  /* The whole class laid out on the form, for the stats and the toolbar
     count, once per class, report, paper and form, after the canvas has
     rendered. In Everyone view the canvas render is that summary. */
  var _classFit = null;
  var _classFitKey = '';
  function _classFitKeyNow() {
    var ctx = ReportBlocks.reportContext();
    return [activeCourse, ctx.termId, reportPaper, JSON.stringify(_formOf())].join('|');
  }
  function _scheduleClassFit() {
    if (activeTab !== 'progress') return;
    var key = _classFitKeyNow();
    if (key === _classFitKey) {
      _renderStudioStats();
      return;
    }
    _classFitKey = key;
    setTimeout(function () {
      if (key !== _classFitKey || activeTab !== 'progress') return;
      try {
        var students = sortStudents(getStudents(activeCourse), 'lastName');
        _classFit = ReportSheets.classSummary(activeCourse, students, ReportBlocks.reportContext(), {
          paper: reportPaper,
          form: _formOf(),
        });
      } catch (e) {
        _classFit = null;
      }
      _renderStudioStats();
    }, 0);
  }

  function _selectBlock(id) {
    studioSelected = id || null;
    var preview = document.getElementById('rb-preview');
    if (preview) _applySelection(preview);
    _renderStudioStats();
  }

  function _announce(text) {
    var live = document.getElementById('studio-live');
    if (live) live.textContent = text;
  }

  function _previewStudent() {
    return _previewStudents()[0] || null;
  }

  var _studioDrag = null;
  function _mountStudioDrag() {
    if (_studioDrag) _studioDrag.destroy();
    var root = document.getElementById('studio');
    if (!root) return;
    _studioDrag = ReportStudio.initDrag(root, {
      form: _formOf,
      setForm: function (f) {
        if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.sheet-cell')) {
          _focusBlock = document.activeElement.closest('.sheet-cell').dataset.block;
        }
        _setForm(f);
      },
      fit: function (slot, id) {
        var st = _previewStudent();
        if (!st) return null;
        try {
          return ReportSheets.fitAt(activeCourse, st, ReportBlocks.reportContext(), {
            form: _formOf(),
            paper: reportPaper,
            slot: slot,
            block: id,
          });
        } catch (e) {
          return null;
        }
      },
      announce: _announce,
      select: _selectBlock,
      label: function (id) {
        return ReportSheets.BLOCKS[id] ? ReportSheets.BLOCKS[id].label : id;
      },
      span: function (id, span) {
        _focusBlock = id;
        _setForm(ReportSheets.setSpan(_formOf(), id, span));
        _announce(ReportSheets.BLOCKS[id].label + ' is now ' + ReportStudio.spanWord(span) + '.');
      },
      remove: function (id) {
        studioSelected = null;
        _setForm(ReportSheets.removeCell(_formOf(), id));
        _announce(ReportSheets.BLOCKS[id].label + ' removed from the report.');
      },
    });
  }

  /* ── Course switching ────────────────────────────────────────── */
  async function switchCourse(cid) {
    activeCourse = cid;
    if (!(await switchActiveCourse(cid))) return;
    selectedStudentIds = null; // reset to all
    viewingIssue = null;
    reportPaper = _loadPaper(cid);
    _applyPaper();
    reportConfig = _loadReportConfig(cid);
    _blockSizes = null;
    _classFitKey = '';
    previewSid = null;
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

    var cell = e.target.closest('.studio-pages .sheet-cell[data-block]');
    if (cell && studioView === 'one' && !viewingIssue) {
      if (!e.target.closest('.studio-handle')) _selectBlock(cell.dataset.block);
      return;
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
      printReports: function () {
        // A chosen copy prints as it is; the live reports save a copy, then print.
        if (viewingIssue) window.print();
        else if (activeTab === 'progress') openIssueDialog();
        else _printNow();
      },
      setPaper: function () {
        setPaper(el.dataset.paper);
        _blockSizes = null;
        renderStudioPanels();
      },
      setInk: function () {
        setView(el.dataset.ink === 'black' ? 'photocopy' : 'screen');
        _syncInkButtons();
      },
      setPages: function () {
        _setForm(
          ReportSheets.setPagesPerStudent(_formOf(), el.dataset.pages === 'auto' ? 'auto' : Number(el.dataset.pages)),
        );
        _syncPagesButtons();
      },
      studioView: function () {
        studioView = el.dataset.view === 'all' ? 'all' : 'one';
        renderReports();
      },
      studioTab: function () {
        studioTab = el.dataset.tab === 'templates' ? 'templates' : 'blocks';
        renderStudioPanels();
      },
      studioBlock: function () {
        var id = el.dataset.block;
        if (ReportSheets.locate(_formOf(), id)) _selectBlock(id);
        else {
          studioSelected = id;
          _setForm(ReportSheets.placeBlock(_formOf(), id));
        }
      },
      studioSpan: function () {
        if (el.disabled) return;
        _setForm(ReportSheets.setSpan(_formOf(), el.dataset.block, Number(el.dataset.span)));
      },
      studioHeight: function () {
        _setForm(ReportSheets.setHeight(_formOf(), el.dataset.block, el.dataset.height));
      },
      studioRemove: function () {
        var id = el.dataset.block;
        studioSelected = null;
        _setForm(ReportSheets.removeCell(_formOf(), id));
      },
      studioTemplate: function () {
        var f = el.dataset.starter ? ReportSheets.starter(el.dataset.starter) : ReportSheets.template(el.dataset.id);
        if (f) _setForm(f);
      },
      toggleRail: function () {
        // Narrow screens hide the palette; this opens it over the pages.
        var layout = document.getElementById('studio');
        if (!layout) return;
        var open = layout.classList.toggle('rail-open');
        el.classList.toggle('active', open);
        el.setAttribute('aria-pressed', open ? 'true' : 'false');
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
      tqSeePage: function () {
        tqSaveCurrentIfNeeded();
        selectedStudentIds = [el.dataset.sid];
        populateStudentSelect();
        switchTab('progress');
      },
      fitMapPick: function () {
        // In Everyone view a student's thumbnail opens that student.
        if (studioView !== 'all') return;
        previewSid = el.dataset.sid;
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

  function _handleStudioChange(e) {
    var el = e.target;
    if (!el || !el.dataset || el.dataset.action !== 'studioLines') return;
    _setForm(ReportSheets.setHeight(_formOf(), el.dataset.block, 'fixed', Number(el.value)));
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
    if (typeof ReportSheets === 'undefined') {
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

  /* The issued copies are kept on the server; this device's copies show at
     once and are refreshed from it when the page opens or the class
     changes. Demo Mode and offline keep the device copies. */
  function _syncFromServer(cid) {
    if (typeof ReportIssues !== 'undefined' && typeof ReportIssues.sync === 'function') {
      ReportIssues.sync(cid).then(function (changed) {
        if (changed && cid === activeCourse) _populateCopies();
      });
    }
  }

  var _resizeTimer = null;
  function _handleResize() {
    if (activeTab !== 'progress') return;
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
    tqIncludeAssignFeedback = true;
    tqObsFilter = 'all';

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
    _addDocListener('change', _handleStudioChange);
    window.addEventListener('resize', _handleResize);
    _addDocListener('selectionchange', _handleSelectionChange);
    _addDocListener('keyup', _handleKeyup);
    _addDocListener('input', _handleNarrativeInput);
    _addDocListener('focusin', _handleLatePolicyFocus);
    _addDocListener('focusout', _handleLatePolicyBlur);
  }

  function destroy() {
    if (_studioDrag) {
      _studioDrag.destroy();
      _studioDrag = null;
    }
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
  }

  /* -- Toolbar HTML (rendered into main on init) ---------- */
  var TOOLBAR_HTML =
    '<div class="report-toolbar no-print">\n      <div class="seg report-seg-control" role="tablist" aria-label="Report type">\n        <button class="seg-btn report-seg-btn active" data-action="switchTab" data-tab="questionnaire" role="tab" aria-selected="true">Term Questionnaire</button>\n        <button class="seg-btn report-seg-btn" data-action="switchTab" data-tab="progress" role="tab" aria-selected="false">Progress Reports</button>\n      </div>\n      <div class="report-stepper" id="report-stepper" style="display:none">\n        <button type="button" class="tq-toolbar-arrow" data-action="stepStudent" data-dir="-1" title="Previous student" aria-label="Previous student"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>\n        <button type="button" class="tq-toolbar-arrow" data-action="stepStudent" data-dir="1" title="Next student" aria-label="Next student"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>\n      </div>\n      <div class="student-picker" id="student-picker">\n        <button class="student-picker-btn" data-action="toggleStudentPicker" aria-label="Select students" aria-expanded="false" aria-haspopup="listbox">\n          <span id="picker-label">All Students</span>\n          <span class="arrow" aria-hidden="true">\u25bc</span>\n        </button>\n        <div class="student-picker-dropdown" id="picker-dropdown"></div>\n      </div>\n      <div class="tq-student-nav" id="tq-student-nav" style="display:none">\n        <button class="tq-toolbar-arrow" data-action="tqPrevStudent" title="Previous student" aria-label="Previous student">\n          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>\n        </button>\n        <span class="tq-student-name" id="tq-student-name"></span>\n        <button class="tq-toolbar-arrow" data-action="tqNextStudent" title="Next student" aria-label="Next student">\n          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>\n        </button>\n        <div class="tq-progress-ring" id="tq-progress-ring">\n          <svg width="30" height="30" viewBox="0 0 30 30">\n            <circle class="ring-bg" cx="15" cy="15" r="12"/>\n            <circle class="ring-fill" id="tq-ring-fill" cx="15" cy="15" r="12" stroke-dasharray="75.4" stroke-dashoffset="75.4"/>\n          </svg>\n          <span class="tq-progress-label" id="tq-progress-label"></span>\n        </div>\n      </div>\n      <select id="report-period" class="report-term-select" aria-label="Report"></select>\n      <select id="report-copy" class="report-term-select" aria-label="Copy" style="display:none"></select>\n      <span class="tb-divider" id="tb-divider" aria-hidden="true">\u2502</span>\n      <span class="tb-label" id="tb-paper-label">Paper</span>\n      <div class="seg seg-sm" id="report-paper" role="radiogroup" aria-label="Paper" style="display:none">\n        <button class="seg-btn active" data-action="setPaper" data-paper="letter" role="radio" aria-checked="true">Letter</button>\n        <button class="seg-btn" data-action="setPaper" data-paper="legal" role="radio" aria-checked="false">Legal</button>\n      </div>\n      <span class="tb-label tb-label-progress">Pages</span>\n      <div class="seg seg-sm" id="report-pages" role="radiogroup" aria-label="Pages per student" style="display:none">\n        <button class="seg-btn" data-action="setPages" data-pages="1" role="radio" aria-checked="false">1</button>\n        <button class="seg-btn" data-action="setPages" data-pages="2" role="radio" aria-checked="false">2</button>\n        <button class="seg-btn active" data-action="setPages" data-pages="auto" role="radio" aria-checked="true">Auto</button>\n      </div>\n      <span class="tb-label tb-label-progress">Ink</span>\n      <div class="seg seg-sm" id="report-ink" role="radiogroup" aria-label="Ink" style="display:none">\n        <button class="seg-btn" data-action="setInk" data-ink="black" role="radio" aria-checked="false">Black</button>\n        <button class="seg-btn active" data-action="setInk" data-ink="colour" role="radio" aria-checked="true">Colour</button>\n      </div>\n      <div style="margin-left:auto;display:flex;align-items:center;gap:8px">\n        <span class="tb-count" id="tb-count"></span>\n        <button class="tb-toggle-btn" id="tb-rail-btn" style="display:none" data-action="toggleRail" aria-pressed="false" aria-controls="studio-palette">Blocks</button>\n        <button class="tb-action-btn" id="tb-print-btn" data-action="printReports">Print Reports</button>\n      </div>\n    </div>\n    <div id="report-output" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto"></div>';

  /* -- Public API ----------------------------------------- */
  return {
    init: init,
    destroy: destroy,
    switchCourse: switchCourse,
  };
})();
