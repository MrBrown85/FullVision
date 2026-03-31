/* == page-reports.js -- Reports page module ================ */
window.PageReports = (function() {
  'use strict';

  /* -- Listener tracking for cleanup ---------------------- */
  var _listeners = [];
  function _addDocListener(type, handler, options) {
    document.addEventListener(type, handler, options);
    _listeners.push({ type: type, handler: handler, options: options });
  }

  var _beforeUnloadHandler = null;

/* ══════════════════════════════════════════════════════════════
   REPORTS PAGE — Logic
   ══════════════════════════════════════════════════════════════ */

var activeCourse;
var activeTab = 'questionnaire';

/* ══════════════════════════════════════════════════════════════
   REPORT BUILDER — Config, presets, persistence
   ══════════════════════════════════════════════════════════════ */
const DEFAULT_BLOCKS = [
  // Identity
  { id:'header',             label:'Header',                   enabled:true,  locked:true  },
  // Academic
  { id:'academic-summary',   label:'Academic Summary',         enabled:true,  locked:false },
  { id:'teacher-narrative',  label:'Teacher Comment',          enabled:true,  locked:false },
  { id:'section-chart',      label:'Section Proficiency Chart', enabled:false, locked:false },
  { id:'grade-table',        label:'Assignment Grades',        enabled:false, locked:false },
  { id:'score-distribution', label:'Score Distribution',       enabled:false, locked:false },
  { id:'section-outcomes',   label:'Learning Outcomes',        enabled:false, locked:false },
  { id:'core-competencies',  label:'Core Competencies',        enabled:false, locked:false },
  // Profile & narrative
  { id:'learner-dimensions', label:'Disposition Dimensions',   enabled:false, locked:false },
  // Student voice
  { id:'student-reflection-learning', label:'Student Reflection: My Learning', enabled:false, locked:false },
  { id:'student-reflection-habits',   label:'Student Reflection: My Habits',   enabled:false, locked:false },
  // Evidence
  { id:'observations',       label:'Observations & Evidence',  enabled:false, locked:false },
  // Growth
  { id:'next-steps',         label:'Growth & Next Steps',      enabled:false, locked:false },
  // Reference
  { id:'legend',             label:'Proficiency Legend',        enabled:false, locked:false },
  // Parent
  { id:'parent-response',    label:'Parent / Guardian Response', enabled:false, locked:false },
];

const REPORT_PRESETS = {
  brief:    ['header', 'academic-summary', 'teacher-narrative'],
  standard: ['header', 'academic-summary', 'teacher-narrative', 'section-chart', 'learner-dimensions', 'next-steps'],
  detailed: ['header', 'academic-summary', 'teacher-narrative', 'section-chart', 'score-distribution', 'grade-table',
             'section-outcomes', 'core-competencies', 'learner-dimensions',
             'student-reflection-learning', 'student-reflection-habits',
             'observations', 'next-steps', 'legend', 'parent-response'],
};

// getReportConfig / saveReportConfig are now in gb-data.js
// Wrap getReportConfig to validate/migrate blocks against DEFAULT_BLOCKS
function getReportConfigWrapped(cid) {
  const parsed = (typeof getReportConfig === 'function') ? getReportConfig(cid) : {};
  if (parsed && parsed.blocks) {
    const validIds = new Set(DEFAULT_BLOCKS.map(b => b.id));
    parsed.blocks = parsed.blocks.filter(b => validIds.has(b.id));
    parsed.blocks.forEach(b => { const db = DEFAULT_BLOCKS.find(d => d.id === b.id); if (db) b.label = db.label; });
    DEFAULT_BLOCKS.forEach(db => {
      if (!parsed.blocks.find(b => b.id === db.id)) {
        parsed.blocks.push({ ...db });
      }
    });
    return parsed;
  }
  // Default to standard preset
  const blocks = DEFAULT_BLOCKS.map(b => ({ ...b }));
  const std = REPORT_PRESETS.standard;
  blocks.forEach(b => { b.enabled = std.includes(b.id); });
  const ordered = [];
  std.forEach(id => { const b = blocks.find(x => x.id === id); if (b) ordered.push(b); });
  blocks.forEach(b => { if (!std.includes(b.id)) ordered.push(b); });
  return { preset:'standard', blocks: ordered };
}

var reportConfig = null;

/* ── Block renderers + helpers now in report-blocks.js ────── */
var getPronouns = ReportBlocks.getPronouns;
var OBS_DESCRIPTORS = ReportBlocks.OBS_DESCRIPTORS;
var getTermId = ReportBlocks.getTermId;
var renderReportBlock = ReportBlocks.renderReportBlock;

/* ── Remaining local references (used by renderStudentReport + class summary) ── */
/* ── Render a single student progress report ─────────────────── */
function renderStudentReport(cid, student) {
  let html = `<div class="report-student">`;
  reportConfig.blocks.forEach(b => {
    if (b.enabled) html += renderReportBlock(b.id, cid, student);
  });
  html += `</div>`;
  return html;
}

/* ── Class Summary ───────────────────────────────────────────── */
var classSummaryAnon = false;
var tqIncludeAssignFeedback = true;
var tqObsFilter = 'all'; // 'all'|'general'|'assignment'

function renderClassSummary(cid) {
  const course = COURSES[cid];
  const sections = getSections(cid);
  let students = sortStudents(getStudents(cid), 'lastName');
  if (classSummaryAnon) students = anonymizeStudents(students);
  const isLetter = course.gradingSystem === 'letter';

  let html = `<h2 style="font-family:var(--font-base);font-size:1.3rem;margin-bottom:12px">${esc(course.name)} &mdash; Class Summary</h2>`;
  html += `<table class="class-summary-table">
    <thead><tr>
      <th scope="col">Student</th>`;

  sections.forEach(sec => {
    html += `<th scope="col">${esc(sec.shortName || sec.name)}</th>`;
  });

  html += `<th scope="col">Overall</th>`;
  if (isLetter) html += `<th scope="col">Letter Grade</th>`;
  html += `</tr></thead><tbody>`;

  students.forEach(st => {
    const nameDisplay = classSummaryAnon ? esc(st._anonLabel) : `<a href="#" data-action="summaryStudentClick" data-sid="${st.id}" style="color:inherit;text-decoration:none">${esc(fullName(st))}</a>`;
    html += `<tr><td class="class-summary-name">${nameDisplay}</td>`;
    sections.forEach(sec => {
      const sp = getSectionProficiency(cid, st.id, sec.id);
      const sr = Math.round(sp);
      const slabel = sp > 0 ? PROF_LABELS[sr] : '—';
      const scolor = sp > 0 ? PROF_COLORS[sr] : 'var(--text-3)';
      html += `<td data-prof="${sr}" style="color:${scolor};font-weight:600">${slabel}</td>`;
    });
    const op = getOverallProficiency(cid, st.id);
    const or2 = Math.round(op);
    const olabel = op > 0 ? PROF_LABELS[or2] : '—';
    const ocolor = op > 0 ? PROF_COLORS[or2] : 'var(--text-3)';
    html += `<td data-prof="${or2}" style="color:${ocolor};font-weight:700">${olabel}</td>`;
    if (isLetter) {
      const lg = op > 0 ? calcLetterGrade(op) : null;
      html += `<td style="font-weight:700">${lg ? lg.letter + ' (' + lg.pct + '%)' : '—'}</td>`;
    }
    html += `</tr>`;
  });

  html += `</tbody></table>`;
  return html;
}

/* ── Tab switching ───────────────────────────────────────────── */
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.report-seg-btn').forEach(t => {
    const isActive = (tab === 'progress' && t.textContent.includes('Progress')) ||
        (tab === 'questionnaire' && t.textContent.includes('Questionnaire')) ||
        (tab === 'summary' && t.textContent.includes('Summary'));
    t.classList.toggle('active', isActive);
    t.setAttribute('aria-selected', isActive);
  });
  // Show/hide contextual toolbar elements
  document.getElementById('student-picker').style.display = tab === 'progress' ? '' : 'none';
  document.getElementById('tq-student-nav').style.display = tab === 'questionnaire' ? 'flex' : 'none';
  // Show Print button only on progress reports and class summary
  const tbPrint = document.getElementById('tb-print-btn');
  if (tbPrint) tbPrint.style.display = tab === 'questionnaire' ? 'none' : '';
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

/* ── Main render ─────────────────────────────────────────────── */
function renderReports() {
  const cid = activeCourse;
  const output = document.getElementById('report-output');

  if (activeTab === 'summary') {
    output.innerHTML = renderClassSummary(cid);
    return;
  }

  if (activeTab === 'questionnaire') {
    output.innerHTML = renderTermQuestionnaire(cid);
    if (window.TqPanelManager) TqPanelManager.init(cid);
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

  // Progress reports — render two-panel builder layout
  const presetBtns = ['brief','standard','detailed'].map(p =>
    `<button class="rb-preset-btn${reportConfig.preset === p ? ' active' : ''}" data-preset="${p}" data-action="rbApplyPreset">${p.charAt(0).toUpperCase()+p.slice(1)}</button>`
  ).join('');

  output.innerHTML = `<div class="rb-layout">
    <aside class="rb-panel no-print" id="rb-panel">
      <div class="rb-panel-header"><div class="rb-panel-title">Report Builder</div></div>
      <div class="rb-presets">${presetBtns}</div>
      <div class="rb-blocks" id="rb-blocks"></div>
    </aside>
    <div class="rb-preview" id="rb-preview"></div>
  </div>`;

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
  const preview = document.getElementById('rb-preview');
  if (!preview) return;
  const cid = activeCourse;
  const allStudents = sortStudents(getStudents(cid), 'lastName');
  const students = selectedStudentIds === null ? allStudents : allStudents.filter(s => selectedStudentIds.includes(s.id));
  const allScoresObj = getScores(cid);
  const hasAnyScores = Object.values(allScoresObj).some(arr => Array.isArray(arr) && arr.some(s => s.score > 0));
  if (!hasAnyScores) {
    preview.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📄</div><div class="empty-state-title">No report data yet</div><div class="empty-state-text">Score some assignments to generate progress reports.</div></div>`;
  } else if (students.length === 0) {
    preview.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:40px 0;font-size:0.95rem">Select students above to generate reports.</div>';
  } else {
    preview.innerHTML = students.map(st => renderStudentReport(cid, st)).join('');
  }
}

function renderBuilderBlocks() {
  const container = document.getElementById('rb-blocks');
  if (!container) return;
  let html = '';
  reportConfig.blocks.forEach((block, idx) => {
    const enabledClass = block.enabled ? ' enabled' : '';
    const lockedClass = block.locked ? ' locked' : '';
    html += `<div class="rb-block${enabledClass}${lockedClass}" data-idx="${idx}">
      <span class="rb-drag-grip"${block.locked ? '' : ' data-drag="grip"'}>${block.locked ? '🔒' : '⠿'}</span>
      ${block.locked
        ? `<span class="rb-block-label">${esc(block.label)}</span>`
        : `<label class="rb-block-toggle" data-action="rbToggleBlock" data-blockid="${block.id}"><div class="rb-block-switch"></div></label>
           <span class="rb-block-label">${esc(block.label)}</span>`
      }
    </div>`;
  });
  container.innerHTML = html;
  _initPointerDrag(container);
}

function rbToggleBlock(blockId) {
  const block = reportConfig.blocks.find(b => b.id === blockId);
  if (!block || block.locked) return;
  block.enabled = !block.enabled;
  reportConfig.preset = 'custom';
  saveReportConfig(activeCourse, reportConfig);
  renderBuilderBlocks();
  renderReportPreview();
  rbUpdatePresetBtns();
}

function rbApplyPreset(preset) {
  const order = REPORT_PRESETS[preset];
  if (!order) return;
  const ordered = [];
  const remaining = [];
  order.forEach(id => {
    const b = reportConfig.blocks.find(x => x.id === id);
    if (b) { b.enabled = true; ordered.push(b); }
  });
  reportConfig.blocks.forEach(b => {
    if (!order.includes(b.id)) { b.enabled = false; remaining.push(b); }
  });
  reportConfig.blocks = [...ordered, ...remaining];
  reportConfig.preset = preset;
  saveReportConfig(activeCourse, reportConfig);
  renderBuilderBlocks();
  renderReportPreview();
  rbUpdatePresetBtns();
}

function rbUpdatePresetBtns() {
  document.querySelectorAll('.rb-preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === reportConfig.preset);
  });
}

/* ── Pointer-based drag-and-drop reorder ── */
var _rbDragIdx = null;
var _dragAbort = null;

function _initPointerDrag(container) {
  if (!container) return;
  // Remove previous listeners to prevent accumulation
  if (_dragAbort) _dragAbort.abort();
  _dragAbort = new AbortController();
  var signal = _dragAbort.signal;
  var dragEl = null;
  var placeholder = null;
  var offsetY = 0;
  var startIdx = -1;
  var blockHeight = 0;

  container.addEventListener('pointerdown', function(e) {
    var grip = e.target.closest('[data-drag="grip"]');
    if (!grip) return;
    var block = grip.closest('.rb-block');
    if (!block) return;
    startIdx = parseInt(block.dataset.idx, 10);
    if (isNaN(startIdx)) return;
    // Prevent text selection and default drag
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    var rect = block.getBoundingClientRect();
    offsetY = e.clientY - rect.top;
    dragEl = block;
    blockHeight = block.offsetHeight + 1; // +1 for margin
    // Create placeholder
    placeholder = document.createElement('div');
    placeholder.className = 'rb-block-placeholder';
    placeholder.style.height = blockHeight + 'px';
    // Style the dragged element
    block.classList.add('dragging');
    block.style.position = 'fixed';
    block.style.top = rect.top + 'px';
    block.style.left = rect.left + 'px';
    block.style.width = rect.width + 'px';
    block.style.zIndex = '1000';
    block.style.pointerEvents = 'none';
    block.parentNode.insertBefore(placeholder, block);
  }, { signal });

  container.addEventListener('pointermove', function(e) {
    if (!dragEl) return;
    e.preventDefault();
    dragEl.style.top = (e.clientY - offsetY) + 'px';
    // Determine target position
    var blocks = Array.from(container.querySelectorAll('.rb-block:not(.dragging)'));
    for (var i = 0; i < blocks.length; i++) {
      var br = blocks[i].getBoundingClientRect();
      var mid = br.top + br.height / 2;
      if (e.clientY < mid) {
        // Don't insert before locked header
        if (blocks[i].classList.contains('locked')) continue;
        container.insertBefore(placeholder, blocks[i]);
        return;
      }
    }
    // Past all blocks — append at end
    container.appendChild(placeholder);
  }, { signal });

  function finishDrag(e) {
    if (!dragEl) return;
    // Find where placeholder ended up (exclude dragging element and placeholder itself)
    var allItems = Array.from(container.children).filter(function(c) { return c !== dragEl; });
    var targetIdx = allItems.indexOf(placeholder);
    // Clean up
    dragEl.classList.remove('dragging');
    dragEl.style.position = '';
    dragEl.style.top = '';
    dragEl.style.left = '';
    dragEl.style.width = '';
    dragEl.style.zIndex = '';
    dragEl.style.pointerEvents = '';
    if (placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
    dragEl = null;
    placeholder = null;
    // Apply the reorder if position changed
    if (targetIdx >= 0 && targetIdx !== startIdx) {
      var moved = reportConfig.blocks.splice(startIdx, 1)[0];
      var insertAt = startIdx < targetIdx ? targetIdx - 1 : targetIdx;
      var finalIdx = Math.max(1, insertAt); // Don't insert before locked header
      reportConfig.blocks.splice(finalIdx, 0, moved);
      reportConfig.preset = 'custom';
      saveReportConfig(activeCourse, reportConfig);
      renderBuilderBlocks();
      renderReportPreview();
      rbUpdatePresetBtns();
    } else {
      // Reset position without re-render
      renderBuilderBlocks();
    }
    startIdx = -1;
  }

  container.addEventListener('pointerup', finishDrag, { signal });
  container.addEventListener('pointercancel', finishDrag, { signal });
}

// Legacy stubs (no longer used but kept for safety in case inline attrs remain)
function rbDragStart() {}
function rbDragEnd() {}
function rbDragOver() {}
function rbDragLeave() {}
function rbDrop() {}

/* ── Course switching ────────────────────────────────────────── */
async function switchCourse(cid) {
  activeCourse = cid;
  setActiveCourse(cid);
  await initData(cid);
  selectedStudentIds = null; // reset to all
  reportConfig = getReportConfigWrapped(cid);
  _configureQuestionnaire();
  populateStudentSelect();
  renderReports();
  document.getElementById('sidebar-mount').innerHTML = renderSidebar(cid, null);
}

/* ── Questionnaire delegation (now in report-questionnaire.js) ── */
var RQ = ReportQuestionnaire;
function getTqStudents() { return RQ.getTqStudents(); }
function tqPrevStudent() { RQ.tqPrevStudent(); }
function tqNextStudent() { RQ.tqNextStudent(); }
function tqSaveCurrentIfNeeded() { RQ.tqSaveCurrentIfNeeded(); }
function tqExec(cmd) { RQ.tqExec(cmd); }
function tqUpdateToolbar() { RQ.tqUpdateToolbar(); }
function tqCopyNarrative() { RQ.tqCopyNarrative(); }
function tqSetDim(sid, dim, val) { RQ.tqSetDim(sid, dim, val); }
function tqSetField(sid, field, val) { RQ.tqSetField(sid, field, val); }
function tqToggleTrait(sid, tid) { RQ.tqToggleTrait(sid, tid); }
function tqToggleAssignment(sid, aid) { RQ.tqToggleAssignment(sid, aid); }
function tqToggleOb(sid, obId) { RQ.tqToggleOb(sid, obId); }
function tqAutoNarrative(sid) { RQ.tqAutoNarrative(sid); }
function tqSelectStudent(sid) { RQ.tqSelectStudent(sid); }
function renderTermQuestionnaire(cid) { return RQ.renderTermQuestionnaire(cid); }

function _configureQuestionnaire() {
  RQ.configure({
    activeCourse: activeCourse,
    renderReports: renderReports,
    tqIncludeAssignFeedback: tqIncludeAssignFeedback,
    tqObsFilter: tqObsFilter
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
      'switchTab':              function() { switchTab(el.dataset.tab); },
      'toggleStudentPicker':    function() { toggleStudentPicker(e); },
      'tqPrevStudent':          function() { tqPrevStudent(); },
      'tqNextStudent':          function() { tqNextStudent(); },
      'toggleAnon':             function() { classSummaryAnon = !classSummaryAnon; el.classList.toggle('active', classSummaryAnon); renderReports(); },
      'printReports':           function() { window.print(); },
      'rbApplyPreset':          function() { rbApplyPreset(el.dataset.preset); },
      'rbToggleBlock':          function() { e.stopPropagation(); rbToggleBlock(el.dataset.blockid); },
      'summaryStudentClick':    function() { e.preventDefault(); tqSelectStudent(el.dataset.sid); switchTab('questionnaire'); },
      'toggleStudentSelection': function() { e.stopPropagation(); toggleStudentSelection(el.dataset.sid); },
      'selectAllStudents':      function() { e.stopPropagation(); selectAllStudents(); },
      'selectNoneStudents':     function() { e.stopPropagation(); selectNoneStudents(); },
      'tqSetDim':               function() { tqSetDim(el.dataset.sid, el.dataset.dim, parseInt(el.dataset.lvl, 10)); },
      'tqSetField':             function() { tqSetField(el.dataset.sid, el.dataset.field, parseInt(el.dataset.lvl, 10)); },
      'tqToggleTrait':          function() { tqToggleTrait(el.dataset.sid, el.dataset.tid); },
      'tqToggleAssignment':     function() { tqToggleAssignment(el.dataset.sid, el.dataset.aid); },
      'tqExec':                 function() { tqExec(el.dataset.cmd); },
      'tqAutoNarrative':        function() { tqAutoNarrative(el.dataset.sid); },
      'tqCopyNarrative':        function() { tqCopyNarrative(); },
      'tqObsFilter':            function() { tqObsFilter = el.dataset.filter; RQ.tqObsFilter = el.dataset.filter; renderReports(); },
      'tqToggleOb':             function() { tqToggleOb(el.dataset.sid, el.dataset.obid); },
      'resetTqLayout':          function() { if (window.TqPanelManager) { TqPanelManager.resetLayout(activeCourse); renderReports(); } }
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

  function _handleKeyup(e) {
    var editor = document.getElementById('tq-narrative');
    if (editor && editor.contains(e.target)) tqUpdateToolbar();
  }

  function _handleReportPeriodChange() {
    renderReports();
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

    reportConfig = getReportConfigWrapped(activeCourse);
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

    // Wire report-period change
    var reportPeriodEl = document.getElementById('report-period');
    if (reportPeriodEl) reportPeriodEl.addEventListener('change', _handleReportPeriodChange);

    // Wire sidebar clicks
    var sidebarEl = document.getElementById('sidebar-mount');
    if (sidebarEl) sidebarEl.addEventListener('click', _handleSidebarClick);

    populateStudentSelect();

    // Handle params
    if (params.student) {
      var students = getTqStudents();
      var idx = students.findIndex(function(s) { return s.id === params.student; });
      if (idx >= 0) RQ.tqStudentIndex = idx;
    }

    switchTab(activeTab);

    // beforeunload handler — save unsaved narrative on browser close/refresh
    _beforeUnloadHandler = function() {
      if (RQ.tqNarrativeDirty) tqSaveCurrentIfNeeded();
    };
    window.addEventListener('beforeunload', _beforeUnloadHandler);

    window._pageSwitchCourse = switchCourse;

    _addDocListener('click', _handleClick);
    _addDocListener('selectionchange', _handleSelectionChange);
    _addDocListener('keyup', _handleKeyup);
    _addDocListener('focusin', _handleLatePolicyFocus);
    _addDocListener('focusout', _handleLatePolicyBlur);
  }

  function destroy() {
    // Clean up panel manager
    if (window.TqPanelManager) TqPanelManager.destroy();
    // Save any unsaved narrative
    if (RQ.tqNarrativeDirty) tqSaveCurrentIfNeeded();

    _listeners.forEach(function(l) {
      document.removeEventListener(l.type, l.handler, l.options);
    });
    _listeners = [];

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
    delete window._tqMarkDirty;
  }

  /* -- Toolbar HTML (rendered into main on init) ---------- */
  var TOOLBAR_HTML = '<div class="report-toolbar no-print">\n      <div class="report-seg-control" role="tablist" aria-label="Report type">\n        <button class="report-seg-btn active" data-action="switchTab" data-tab="questionnaire" role="tab" aria-selected="true">Term Questionnaire</button>\n        <button class="report-seg-btn" data-action="switchTab" data-tab="progress" role="tab" aria-selected="false">Progress Reports</button>\n        <button class="report-seg-btn" data-action="switchTab" data-tab="summary" role="tab" aria-selected="false">Class Summary</button>\n      </div>\n      <div class="student-picker" id="student-picker">\n        <button class="student-picker-btn" data-action="toggleStudentPicker" aria-label="Select students" aria-expanded="false" aria-haspopup="listbox">\n          <span id="picker-label">All Students</span>\n          <span class="arrow" aria-hidden="true">\u25bc</span>\n        </button>\n        <div class="student-picker-dropdown" id="picker-dropdown"></div>\n      </div>\n      <div class="tq-student-nav" id="tq-student-nav" style="display:none">\n        <button class="tq-toolbar-arrow" data-action="tqPrevStudent" title="Previous student" aria-label="Previous student">\n          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>\n        </button>\n        <span class="tq-student-name" id="tq-student-name"></span>\n        <button class="tq-toolbar-arrow" data-action="tqNextStudent" title="Next student" aria-label="Next student">\n          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>\n        </button>\n        <div class="tq-progress-ring" id="tq-progress-ring">\n          <svg width="30" height="30" viewBox="0 0 30 30">\n            <circle class="ring-bg" cx="15" cy="15" r="12"/>\n            <circle class="ring-fill" id="tq-ring-fill" cx="15" cy="15" r="12" stroke-dasharray="75.4" stroke-dashoffset="75.4"/>\n          </svg>\n          <span class="tq-progress-label" id="tq-progress-label"></span>\n        </div>\n      </div>\n      <select id="report-period" class="report-term-select" aria-label="Reporting period">\n        <option value="Report 1">Report 1</option>\n        <option value="Report 2">Report 2</option>\n        <option value="Report 3">Report 3</option>\n        <option value="Report 4">Report 4</option>\n        <option value="Report 5">Report 5</option>\n        <option value="Report 6">Report 6</option>\n      </select>\n      <div style="margin-left:auto;display:flex;align-items:center;gap:8px">\n        <button class="tb-toggle-btn" id="tb-anon-btn" style="display:none" data-action="toggleAnon">\n          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>\n          Anonymize\n        </button>\n        <button class="tb-action-btn" id="tb-print-btn" data-action="printReports">Print Reports</button>\n      </div>\n    </div>\n    <div id="report-output" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto"></div>';

  /* -- Expose handlers for inline event attributes --------- */
  window.rbDragStart = rbDragStart;
  window.rbDragEnd = rbDragEnd;
  window.rbDragOver = rbDragOver;
  window.rbDragLeave = rbDragLeave;
  window.rbDrop = rbDrop;
  window._tqMarkDirty = function() { RQ.tqNarrativeDirty = true; };

  /* -- Public API ----------------------------------------- */
  return {
    init: init,
    destroy: destroy,
    switchCourse: switchCourse
  };
})();
