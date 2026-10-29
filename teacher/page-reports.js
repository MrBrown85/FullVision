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
  var phonesView = false; // Progress Reports › Sent to Phones (teacher/phone-reports.js)

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
  function _syncSidesButtons() {
    var n = _formOf().sides.length > 1 ? '2' : '1';
    document.querySelectorAll('#report-sides .seg-btn').forEach(function (b) {
      var on = b.dataset.sides === n;
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

  /* ── Tab switching ───────────────────────────────────────────── */
  function switchTab(tab) {
    // A comment typed in the last moment is saved before the page changes.
    RQ.tqSaveCurrentIfNeeded();
    activeTab = tab;
    viewingIssue = null;
    segSelect(document.querySelector('.report-seg-btn[data-tab="' + tab + '"]'));
    // Show/hide contextual toolbar elements
    document.getElementById('student-picker').style.display = tab === 'progress' ? '' : 'none';
    document.getElementById('tq-student-nav').style.display = tab === 'questionnaire' ? 'flex' : 'none';
    document.querySelectorAll('.tq-only').forEach(function (el) {
      el.style.display = tab === 'questionnaire' ? '' : 'none';
    });
    if (tab !== 'questionnaire') RQ.restoreRoster();
    var out = document.getElementById('report-output');
    if (out) out.classList.toggle('qn-output', tab === 'questionnaire');
    // Show Print button only on progress reports and class summary
    const tbPrint = document.getElementById('tb-print-btn');
    if (tbPrint) tbPrint.style.display = tab === 'questionnaire' ? 'none' : '';
    const tbPaper = document.getElementById('report-paper');
    if (tbPaper) tbPaper.style.display = tab === 'questionnaire' ? 'none' : '';
    ['report-sides', 'report-ink', 'tb-divider', 'tb-paper-label', 'tb-save-template'].forEach(function (id) {
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
      _syncSidesButtons();
    }
    const tbRail = document.getElementById('tb-rail-btn');
    if (tbRail) tbRail.style.display = tab === 'progress' ? '' : 'none';
    if (tab !== 'progress') phonesView = false;
    _syncPhonesButton();
    const stepper = document.getElementById('report-stepper');
    if (stepper) stepper.style.display = tab === 'progress' ? '' : 'none';
    if (tab !== 'progress') _restoreSidebarBadges();
    var layout = document.getElementById('page-layout');
    if (layout) layout.classList.toggle('sidebar-hidden', !_sidebarVisible);
    renderReports();
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
    if (activeTab === 'questionnaire') {
      if (typeof setLongFormAuthContext === 'function') {
        setLongFormAuthContext({
          kind: 'term-rating',
          getDraftText: function () {
            var box = document.getElementById('tq-narrative');
            return box ? box.value || '' : '';
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
      RQ.afterRender();
      return;
    }

    _syncLongFormAuthContext();

    // Progress Reports › Sent to Phones: this period's report on the
    // students' phones (teacher/phone-reports.js).
    if (phonesView && typeof PhoneReports !== 'undefined') {
      output.innerHTML = PhoneReports.panelHtml(cid, ReportBlocks.reportContext());
      return;
    }

    // Progress Reports: Page Studio (report-studio.js)
    output.innerHTML = ReportStudio.layoutHtml({ view: studioView });
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
    var z = ReportStudio.fitZoom(preview.clientWidth || 800, reportPaper);
    preview.style.setProperty('--sheet-zoom', String(z.zoom));
    preview.classList.toggle('studio-stacked', !!z.stacked);
  }

  /* + Page after the last side; Empty · Remove on an empty side past the
     second. One Student view only. */
  function _decoratePages(preview) {
    if (studioView !== 'one' || viewingIssue) return;
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

  /* The selected block: a blue outline on the page and its card in the
     gutter beside the pages (in the canvas, not the scaled page, so it
     reads at screen size), level with the block; the Options popover
     under the card when it is open. */
  function _applySelection(preview) {
    preview.querySelectorAll('.sheet-cell.studio-sel').forEach(function (el) {
      el.classList.remove('studio-sel');
    });
    preview.querySelectorAll('.studio-bar, .studio-pop').forEach(function (el) {
      el.remove();
    });
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
    if (!studioSelected || studioView !== 'one' || viewingIssue) return;
    var cells = preview.querySelectorAll('.sheet-body .sheet-cell[data-block="' + studioSelected + '"]');
    if (!cells.length) return;
    var first = cells[0];
    cells.forEach(function (el) {
      el.classList.add('studio-sel');
    });
    var st = _previewStudent();
    var who = st ? { id: st.id, name: fullName(st) } : null;
    var bar = document.createElement('div');
    bar.innerHTML = ReportStudio.blockToolbarHtml(_formOf(), studioSelected, who);
    var barEl = bar.firstElementChild;
    if (!barEl) return;
    preview.appendChild(barEl);
    var pr = preview.getBoundingClientRect();
    var cr = first.getBoundingClientRect();
    // The gutter: right of the rightmost page, level with the block.
    var right = 0;
    preview.querySelectorAll('.sheet-zoom').forEach(function (z) {
      right = Math.max(right, z.getBoundingClientRect().right);
    });
    var left = right - pr.left + preview.scrollLeft + 16;
    if (left + barEl.offsetWidth > preview.clientWidth + preview.scrollLeft) {
      // No gutter (stacked pages): under the block instead.
      left = Math.max(0, cr.left - pr.left + preview.scrollLeft);
      barEl.style.top = cr.bottom - pr.top + preview.scrollTop + 8 + 'px';
    } else {
      barEl.style.top = Math.max(0, cr.top - pr.top + preview.scrollTop) + 'px';
    }
    barEl.style.left = left + 'px';
    if (popoverOpen === studioSelected && ReportStudio.hasOptions(studioSelected)) {
      var pop = document.createElement('div');
      pop.innerHTML = ReportStudio.popoverHtml(_formOf(), studioSelected, ReportBlocks.showDefaults(activeCourse));
      var popEl = pop.firstElementChild;
      if (popEl) {
        preview.appendChild(popEl);
        popEl.style.left = barEl.style.left;
        popEl.style.top = parseFloat(barEl.style.top) + barEl.offsetHeight + 6 + 'px';
        var btn = barEl.querySelector('[data-action="studioOptions"]');
        if (btn) btn.setAttribute('aria-expanded', 'true');
      }
    } else {
      popoverOpen = null;
    }
  }
  var _focusBlock = null;
  var popoverOpen = null; // the block whose Options popover is open

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
    var s = _lastSummary || { perStudent: {}, continued: [], noComment: [], noAttendance: [] };
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
    // The Letterhead's Name option, here too so it can be set at print time.
    var nameStyle = ReportSheets.optionsFor(ReportSheets.cellOf(form, 'header') || { block: 'header' }).name;
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
      _setForm(ReportSheets.setOption(_formOf(), 'header', 'name', t.value));
      if (_issueState) _issueState.counts = _issueCounts();
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
  var previewAuto = true; // previewSid was chosen for the teacher (the longest report), not by them
  var studioSelected = null; // the selected block id
  var studioTab = 'blocks'; // the palette's tab
  var _blockSizes = null; // every block's Row and Side by Side height for the class, measured once per class/paper/type

  /* Every edit saves the form and can be undone: `label` names the change
     on the Undo toast ("Moved Teacher Comment up"); without one there is
     no toast (an Undo itself, or a change the caller announces). */
  function _setForm(form, label) {
    var before = reportConfig.form ? JSON.parse(JSON.stringify(reportConfig.form)) : null;
    reportConfig.form = ReportSheets.normalizeForm(form);
    // Heights follow each placed block's options and lines; a move or a
    // size change keeps them.
    if (before && _optionsOf(before) !== _optionsOf(reportConfig.form)) _blockSizes = null;
    saveReportConfig(activeCourse, reportConfig);
    if (studioSelected && !ReportSheets.locate(reportConfig.form, studioSelected)) studioSelected = null;
    _classFitKey = '';
    renderStudioPanels();
    renderReportPreview();
    updateCommentFit();
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
      palette.innerHTML = ReportStudio.paletteHtml(
        _formOf(),
        studioTab,
        ReportSheets.templates(),
        _blockSizes,
        _classFitKey === _classFitKeyNow() ? _classFit : null,
        studioTab === 'templates' ? _templateThumbs() : null,
      );
      ReportStudio.fitThumbs(palette);
    }
    _renderFitLine();
  }

  function _renderFitLine() {
    var line = document.getElementById('studio-fit');
    if (!line) return;
    line.innerHTML = ReportStudio.fitLineHtml(_classFitKey === _classFitKeyNow() ? _classFit : null, _formOf());
    line.classList.toggle('ok', !!line.textContent && !line.firstElementChild);
  }

  /* Each starter and saved template drawn with the previewed student's
     real report, for the Templates tab: { id: { html, sheets } }. Measured
     once per class, student, paper and library. */
  var _thumbCache = { key: '', thumbs: null };
  function _templateThumbs() {
    var st = _previewStudent();
    if (!st) return null;
    var list = ReportSheets.templates();
    var key = [activeCourse, st.id, reportPaper, ReportBlocks.reportContext().termId, JSON.stringify(list)].join('|');
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
     class, report, paper and form, after the canvas has rendered. In
     Everyone view the canvas render is that summary. */
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
      _renderFitLine();
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
      // The palette greys the blocks with no room once the fit is in.
      renderStudioPanels();
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
      if (changed && studioTab === 'templates' && activeTab === 'progress') renderStudioPanels();
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
    if (id !== studioSelected) popoverOpen = null;
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
            var full = to.side === 0 ? 'The Front is full' : to.side === 1 ? 'The Back is full' : 'That page is full';
            label += ' to the ' + (next === 1 ? 'Back' : next === 0 ? 'Front' : 'Page ' + (next + 1)) + '. ' + full;
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
    });
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
  function _removeBlock(id) {
    if (studioSelected === id) studioSelected = null;
    if (popoverOpen === id) popoverOpen = null;
    _setForm(ReportSheets.removeCell(_formOf(), id), 'Removed ' + _label(id));
    _announce(_label(id) + ' removed from the report.');
  }

  /* ── Course switching ────────────────────────────────────────── */
  async function switchCourse(cid) {
    RQ.tqSaveCurrentIfNeeded();
    // A pending Undo belongs to the class being left.
    if (typeof dismissUndoToast === 'function') dismissUndoToast();
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
    previewAuto = true;
    studioSelected = null;
    popoverOpen = null;
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
      commentFit: _queueCommentFit,
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

    // The Options popover closes on a click anywhere outside it and its button.
    if (popoverOpen && !e.target.closest('.studio-pop, [data-action="studioOptions"]')) {
      popoverOpen = null;
      var pv = document.getElementById('rb-preview');
      if (pv) _applySelection(pv);
    }
    var cell = e.target.closest('.studio-pages .sheet-body .sheet-cell[data-block]');
    if (cell && studioView === 'one' && !viewingIssue) {
      _selectBlock(cell.dataset.block);
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
        // A block already on the form comes off it (Undo puts it back). One
        // that isn't lands in a row of its own: on the Front when it has room for
        // every student, else on the Back, with a toast that says so. A
        // block taller than a side prints after the report.
        var id = el.dataset.block;
        var f = _formOf();
        if (ReportSheets.locate(f, id)) return _removeBlock(id);
        if (el.getAttribute('aria-disabled') === 'true') return;
        var land = _landing(id);
        if (!land) return;
        studioSelected = id;
        var label = 'Added ' + _label(id);
        if (land.after) label += '. It prints after the report';
        else if (land.side > 0 && f.sides.length > 1)
          label += ' to the ' + (land.side === 1 ? 'Back' : 'Page ' + (land.side + 1)) + '. The Front is full';
        _setForm(ReportSheets.insert(f, id, { side: land.side }), label);
        _announce(ReportStudio.placeText(_formOf(), id) + '.');
      },
      studioChoice: function () {
        popoverOpen = null;
        var v = el.dataset.value;
        _setForm(
          ReportSheets.setOption(_formOf(), el.dataset.block, el.dataset.key, /^\d+$/.test(v) ? Number(v) : v),
          'Changed ' + _label(el.dataset.block) + ' options',
        );
      },
      studioNoEvidence: function () {
        popoverOpen = null;
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
          'Moved ' + _label(id) + ' to the ' + (to === 0 ? 'Front' : to === 1 ? 'Back' : 'Page ' + (to + 1)),
        );
        _announce(ReportStudio.placeText(_formOf(), id) + '.');
      },
      studioOptions: function () {
        popoverOpen = popoverOpen === el.dataset.block ? null : el.dataset.block;
        var pv = document.getElementById('rb-preview');
        if (pv) _applySelection(pv);
        var pop = document.getElementById('studio-pop');
        var firstField = pop && pop.querySelector('input, button, textarea');
        if (firstField) firstField.focus();
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
      tqClear: function () {
        RQ.tqClear();
      },
      tqApprove: function () {
        RQ.tqApprove();
      },
      tqCommentTab: function () {
        RQ.tqCommentTab(el.dataset.tab);
      },
      tqRosterFilter: function () {
        RQ.tqRosterFilter(el.dataset.filter);
      },
      tqEvidenceTab: function () {
        RQ.tqEvidenceTab(el.dataset.tab);
      },
      tqAdd: function () {
        RQ.tqAdd(el);
      },
      tqGenerate: function () {
        RQ.tqGenerate();
      },
      tqRate: function () {
        RQ.tqRate(el.dataset.habit, el.dataset.value);
      },
      tqPickNote: function () {
        RQ.tqPickNote(el.dataset.value);
      },
      tqPickFocus: function () {
        RQ.tqPickFocus(el.dataset.value);
      },
      tqPickICan: function () {
        RQ.tqPickICan(el.dataset.value);
      },
      tqMore: function () {
        RQ.tqMore(el.dataset.part);
      },
      tqQuestions: function () {
        RQ.tqOpenQuestions();
      },
      tqCloseQuestions: function () {
        RQ.tqCloseQuestions();
      },
      tqOpenProgress: function () {
        RQ.tqCloseQuestions();
        tqSaveCurrentIfNeeded();
        switchTab('progress');
      },
    };
    if (handlers[action]) {
      handlers[action]();
    } else if (/^pp[A-Z]/.test(action) && typeof PhoneReports !== 'undefined') {
      e.preventDefault();
      PhoneReports.handleAction(action, el, activeCourse, ReportBlocks.reportContext());
    }
  }

  /* Escape closes the Options popover and puts focus back on its button. */
  function _handleStudioKey(e) {
    if (e.key !== 'Escape' || !popoverOpen) return;
    popoverOpen = null;
    var pv = document.getElementById('rb-preview');
    if (pv) _applySelection(pv);
    var btn = pv && pv.querySelector('[data-action="studioOptions"]');
    if (btn) btn.focus();
  }

  function _handleStudioChange(e) {
    var el = e.target;
    if (!el || !el.dataset) return;
    // The questionnaire's attendance boxes save when they change.
    if (el.dataset.tqAtt) {
      RQ.tqSetAttendance(el.dataset.sid);
      return;
    }
    // The Questions sheet's What FullVision Has boxes.
    if (el.dataset.tqCard) {
      RQ.tqSetCard(el.dataset.tqCard, el.checked);
      return;
    }
    var a = el.dataset.action;
    if (a === 'studioOption') {
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
  }

  /* ── The comment box knows the form's room ─────────────────────
     The line meter: the comment's printed lines on the class's form
     against the Teacher Comment box's Lines, measured as it is typed. */
  var _fitTimer = null;
  function _queueCommentFit() {
    clearTimeout(_fitTimer);
    _fitTimer = setTimeout(updateCommentFit, 250);
  }
  function updateCommentFit() {
    if (activeTab !== 'questionnaire' || typeof ReportSheets === 'undefined') return;
    var student = getTqStudents()[RQ.tqStudentIndex];
    var box = document.getElementById('tq-narrative');
    if (!student || !box) return;
    var ctx = ReportBlocks.reportContext();
    ctx.narrativeOverride = box.value;
    var r = ReportSheets.describeStudent(activeCourse, student, ctx, { paper: reportPaper, form: _formOf() });
    RQ.setMeter(r.commentLines || 0, r.room || 0);
  }

  /* ⌘ Return and the arrow keys on the questionnaire. */
  function _handleQuestionnaireKey(e) {
    if (activeTab === 'questionnaire') RQ.handleKey(e);
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
        if (cid === activeCourse && activeTab === 'progress') renderReports();
      });
    }
    // Attendance totals are read here, not with the class, and redraw the
    // page only when they changed and the teacher isn't typing in a box.
    if (typeof loadTermAttendance === 'function') {
      loadTermAttendance(cid).then(function (changed) {
        var typing = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.tqAtt;
        if (changed && cid === activeCourse && !typing) renderReports();
      });
    }
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
    var href = row.getAttribute('data-href') || '';
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
  function init(params) {
    activeCourse = params.course || getActiveCourse();
    setActiveCourse(activeCourse);
    activeTab = params.tab || 'questionnaire';
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
    _addDocListener('keydown', _handleStudioKey);
    window.addEventListener('resize', _handleResize);
    _addDocListener('keydown', _handleQuestionnaireKey);
    _addDocListener('input', _handleNarrativeInput);
    _addDocListener('focusin', _handleLatePolicyFocus);
    _addDocListener('focusout', _handleLatePolicyBlur);
  }

  function destroy() {
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
    // Save any unsaved narrative
    if (RQ.tqNarrativeDirty) tqSaveCurrentIfNeeded();
    var paperStyle = document.getElementById(PAPER_STYLE_ID);
    if (paperStyle) paperStyle.remove();
    if (typeof ReportSheets !== 'undefined') ReportSheets.clearPageStyle();
    _restoreSidebarBadges();
    RQ.restoreRoster();
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
    '<div class="page-toolbar report-toolbar no-print">\n      <div class="seg report-seg-control" role="tablist" aria-label="Report type">\n        <button class="seg-btn report-seg-btn active" data-action="switchTab" data-tab="questionnaire" role="tab" aria-selected="true">Term Questionnaire</button>\n        <button class="seg-btn report-seg-btn" data-action="switchTab" data-tab="progress" role="tab" aria-selected="false">Progress Reports</button>\n      </div>\n      <div class="report-stepper" id="report-stepper" style="display:none">\n        <button type="button" class="tq-toolbar-arrow" data-action="stepStudent" data-dir="-1" title="Previous student" aria-label="Previous student"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>\n        <button type="button" class="tq-toolbar-arrow" data-action="stepStudent" data-dir="1" title="Next student" aria-label="Next student"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>\n      </div>\n      <div class="student-picker" id="student-picker">\n        <button class="student-picker-btn" data-action="toggleStudentPicker" aria-label="Select students" aria-expanded="false" aria-haspopup="listbox">\n          <span id="picker-label">All Students</span>\n        </button>\n        <div class="student-picker-dropdown" id="picker-dropdown"></div>\n      </div>\n      <div class="tq-student-nav" id="tq-student-nav" style="display:none">\n        <div class="qn-stepper">\n          <button type="button" class="tq-toolbar-arrow" data-action="tqPrevStudent" title="Previous Student" aria-label="Previous Student">\u2039</button>\n          <span class="tq-student-name" id="tq-student-name"></span>\n          <button type="button" class="tq-toolbar-arrow" data-action="tqNextStudent" title="Next Student" aria-label="Next Student">\u203A</button>\n        </div>\n        <span class="qn-pos" id="tq-student-pos"></span>\n      </div>\n      <select id="report-period" class="term-select" aria-label="Report"></select>\n      <select id="report-copy" class="term-select" aria-label="Copy" style="display:none"></select>\n      <span class="tb-divider" id="tb-divider" aria-hidden="true">\u2502</span>\n      <span class="tb-label" id="tb-paper-label">Paper</span>\n      <div class="seg seg-sm" id="report-paper" role="radiogroup" aria-label="Paper" style="display:none">\n        <button class="seg-btn active" data-action="setPaper" data-paper="letter" role="radio" aria-checked="true">Letter</button>\n        <button class="seg-btn" data-action="setPaper" data-paper="legal" role="radio" aria-checked="false">Legal</button>\n      </div>\n      <span class="tb-label tb-label-progress">Sides</span>\n      <div class="seg seg-sm" id="report-sides" role="radiogroup" aria-label="Sides" style="display:none">\n        <button class="seg-btn" data-action="setSides" data-sides="1" role="radio" aria-checked="false">Front Only</button>\n        <button class="seg-btn active" data-action="setSides" data-sides="2" role="radio" aria-checked="true">Front and Back</button>\n      </div>\n      <span class="tb-label tb-label-progress">Ink</span>\n      <div class="seg seg-sm" id="report-ink" role="radiogroup" aria-label="Ink" style="display:none">\n        <button class="seg-btn" data-action="setInk" data-ink="black" role="radio" aria-checked="false">Black</button>\n        <button class="seg-btn active" data-action="setInk" data-ink="colour" role="radio" aria-checked="true">Colour</button>\n      </div>\n      <div style="margin-left:auto;display:flex;align-items:center;gap:8px">\n        <span class="qn-ready tq-only" id="tq-ready" style="display:none"></span>\n        <button type="button" class="tb-toggle-btn tq-only" id="tq-questions-btn" style="display:none" data-action="tqQuestions" aria-haspopup="dialog">Questions</button>\n        <button type="button" class="tb-action-btn tq-only" id="tq-save-next" style="display:none" data-action="tqNextStudent" title="\u2318 Return">Save and Next \u203A</button>\n        <button class="tb-toggle-btn" id="tb-phones-btn" style="display:none" data-action="togglePhones" aria-pressed="false">Sent to Phones</button>\n        <button class="tb-toggle-btn" id="tb-rail-btn" style="display:none" data-action="toggleRail" aria-pressed="false" aria-controls="studio-palette">Blocks</button>\n        <button class="tb-toggle-btn" id="tb-save-template" style="display:none" data-action="openSaveTemplate">Save as Template</button>\n        <button class="tb-action-btn" id="tb-print-btn" data-action="printReports">Print Reports</button>\n      </div>\n    </div>\n    <div id="report-output" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto"></div>';

  /* -- Public API ----------------------------------------- */
  return {
    init: init,
    destroy: destroy,
    switchCourse: switchCourse,
    // A redraw from elsewhere (Sent to Phones) only while the page is up.
    renderReports: function () {
      if (document.getElementById('report-output')) renderReports();
    },
  };
})();
