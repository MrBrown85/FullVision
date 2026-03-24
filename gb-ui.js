/* gb-ui.js — Shared UI components for TeacherDashboard */

/* ── HTML sanitizer for contenteditable output ──────────────── */
function sanitizeHtml(raw) {
  var allowed = ['B','STRONG','I','EM','U','UL','OL','LI','BR','P','DIV','SPAN'];
  var tmp = document.createElement('div');
  tmp.innerHTML = raw;
  (function walk(node) {
    for (var i = node.childNodes.length - 1; i >= 0; i--) {
      var child = node.childNodes[i];
      if (child.nodeType === 1) {
        if (allowed.indexOf(child.tagName) === -1) {
          child.replaceWith(document.createTextNode(child.textContent));
        } else {
          [].slice.call(child.attributes).forEach(function(a) { child.removeAttribute(a.name); });
          walk(child);
        }
      }
    }
  })(tmp);
  return tmp.innerHTML;
}

/* ── Shared HTML: Unified Toolbar ──────────────────────────── */
function renderDock(activePage, rightHTML) {
  const ap = activePage === 'student' ? 'dashboard' : activePage;
  const seg = TB_PAGES.map(p =>
    `<a href="${p.href}" class="tb-seg-link${p.id===ap?' tb-seg-active':''}">${p.label}</a>`
  ).join('');

  const userMenu = `<div class="tb-user-menu">
    <button class="tb-user-btn" data-action="toggleUserMenu" title="Account" aria-label="Account menu" aria-expanded="false" aria-haspopup="true">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="5" r="3"/><path d="M2 14c0-3 2.5-5 6-5s6 2 6 5"/></svg>
      <span class="tb-user-name" id="tb-user-name"></span>
    </button>
    <div class="tb-user-dropdown">
      <button class="tb-user-signout" data-action="signOut">Sign Out</button>
      <div style="border-top:1px solid var(--border);margin-top:4px;padding-top:4px">
        <button class="tb-user-delete" data-action="deleteAccount" style="font-size:var(--text-xs);color:var(--score-1);background:none;border:none;cursor:pointer;padding:4px 8px;width:100%;text-align:left">Delete All Data</button>
      </div>
    </div>
  </div>`;

  return `<nav id="app-dock" role="navigation" aria-label="Main navigation">
    <div class="tb-group tb-left">
      <button class="tb-btn" data-action="toggleSidebar" title="Toggle Sidebar" aria-label="Toggle Sidebar">${TB_SIDEBAR_SVG}</button>
    </div>
    <div class="tb-group tb-center">
      <div class="tb-seg">${seg}</div>
    </div>
    <div class="tb-group tb-right">${rightHTML||''}<div class="tb-sync" role="status" aria-label="Sync status"><div class="tb-sync-dot idle" id="sync-indicator-dot" title="All changes saved" aria-label="All changes saved"></div></div>${userMenu}</div>
  </nav>`;
}

/* ── Populate user display name in dock ────────────────────── */
function _populateDockUser() {
  const el = document.getElementById('tb-user-name');
  if (!el || typeof getSupabase !== 'function') return;
  getSupabase().auth.getSession().then(({ data: { session } }) => {
    if (!session) return;
    const user = session.user;
    const name = user.user_metadata?.display_name || user.email?.split('@')[0] || 'User';
    el.textContent = name;
  }).catch(err => {
    console.warn('Could not load user session for dock:', err);
    el.textContent = 'User';
  });
}
// Run after DOM renders (next tick)
setTimeout(_populateDockUser, 0);

/* ── Prefetch (disabled in SPA — all modules already loaded) ── */

// Close user dropdown on click outside
document.addEventListener('click', function(e) {
  const menu = document.querySelector('.tb-user-menu');
  if (menu && !menu.contains(e.target)) menu.classList.remove('open');
});

/* ── Upcoming Birthdays ────────────────────────────────────── */
function getUpcomingBirthdays(cid) {
  const students = getStudents(cid);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisYear = today.getFullYear();

  return students
    .filter(s => s.dateOfBirth)
    .map(s => {
      const dob = new Date(s.dateOfBirth);
      let nextBday = new Date(thisYear, dob.getMonth(), dob.getDate());
      nextBday.setHours(0, 0, 0, 0);
      if (nextBday < today) nextBday.setFullYear(thisYear + 1);
      const daysUntil = Math.round((nextBday - today) / (1000 * 60 * 60 * 24));
      return { student: s, nextBday, daysUntil };
    })
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 3);
}

/* ── Shared HTML: Student Header ────────────────────────────── */
function renderStudentHeader(cid, sid, opts) {
  opts = opts || {};
  const course = COURSES[cid];
  const students = getStudents(cid);
  const student = students.find(s => s.id === sid);
  if (!student) return '';

  const sections = getSections(cid);
  const allTags = getAllTags(cid);
  const assessments = getAssessments(cid);
  const overall = getOverallProficiency(cid, sid);
  const overallRounded = Math.round(overall);
  const profColor = PROF_COLORS[overallRounded] || PROF_COLORS[0];

  // Completion stats
  const coveredTags = allTags.filter(t => {
    const sc = getTagScores(cid, sid, t.id);
    return sc.some(s => s.type === 'summative' && s.score > 0);
  }).length;
  const scoredAssessments = new Set();
  const allScores = getScores(cid)[sid] || [];
  allScores.forEach(s => { if (s.score > 0) scoredAssessments.add(s.assessmentId); });
  const completionPct = getCompletionPct(cid, sid);

  // Observations
  const obs = getStudentQuickObs(cid, sid);

  // Attendance
  const att = student.attendance || [];
  const attPresent = att.filter(a => a.status === 'present').length;
  const attAbsent = att.filter(a => a.status === 'absent').length;
  const attLate = att.filter(a => a.status === 'late').length;
  const attRate = att.length > 0 ? Math.round((attPresent / att.length) * 100) : null;

  // NS / EXC counts
  const statuses = getAssignmentStatuses(cid);
  const nsAssignments = [], excAssignments = [], lateAssignments = [];
  assessments.forEach(a => {
    const st = statuses[sid + ':' + a.id];
    if (st === 'notSubmitted') nsAssignments.push(a.title);
    else if (st === 'excused') excAssignments.push(a.title);
    else if (st === 'late') lateAssignments.push(a.title);
  });

  let html = `<div class="student-header-top">`;
  // Row 1: avatar + name | proficiency | stats | button
  html += `<div class="sh-row1">`;
  html += `<div class="student-identity">
    <div class="student-avatar-xl">${initials(student)}</div>
    <div class="student-identity-text">
      <div class="student-name-xl">${esc(displayName(student))}</div>
      ${student.pronouns ? `<div class="student-pronouns">${esc(student.pronouns)}</div>` : ''}
    </div>
  </div>`;
  html += `<div class="overall-card">
    <div class="overall-val" style="color:${profColor}">${overall > 0 ? overall.toFixed(1) : '\u2014'}</div>
    <div class="overall-word" style="color:${profColor}">${PROF_LABELS[overallRounded] || 'No Evidence'}</div>
  </div>`;
  if (typeof calcLetterGrade === 'function' && course.gradingSystem === 'letter' && overall > 0) {
    const lg = calcLetterGrade(overall);
    html += `<div class="letter-card">
      <div class="letter-val">${lg.letter}</div>
      <div class="letter-pct">${lg.pct}%</div>
    </div>`;
  }
  html += `<div class="sh-spacer"></div>`;
  html += `<div class="sh-stats">`;
  html += `<div class="sh-stat">
    <div class="sh-stat-val">${scoredAssessments.size}<span style="font-size:0.7em;font-weight:500;color:var(--text-3)">/${assessments.length}</span></div>
    <div class="sh-stat-label">Assessed</div>
  </div>`;
  html += `<div class="sh-stat">
    <div class="sh-stat-val">${coveredTags}<span style="font-size:0.7em;font-weight:500;color:var(--text-3)">/${allTags.length}</span></div>
    <div class="sh-stat-label">Tags</div>
  </div>`;
  html += `<div class="sh-stat">
    <div class="sh-stat-val">${obs.length}</div>
    <div class="sh-stat-label">Observations</div>
  </div>`;
  if (attRate !== null) {
    const attColor = attRate >= 90 ? 'var(--score-3)' : attRate >= 75 ? 'var(--score-2)' : 'var(--score-1)';
    html += `<div class="sh-stat">
      <div class="sh-stat-val" style="color:${attColor}">${attRate}%</div>
      <div class="sh-stat-label">Attendance</div>
    </div>`;
  }
  if (nsAssignments.length > 0) {
    html += `<div class="sh-stat" title="${nsAssignments.map(t => esc(t)).join('\n')}">
      <div class="sh-stat-val" style="color:var(--score-1)">${nsAssignments.length}</div>
      <div class="sh-stat-label">Not Submitted</div>
    </div>`;
  }
  if (excAssignments.length > 0) {
    html += `<div class="sh-stat" title="${excAssignments.map(t => esc(t)).join('\n')}">
      <div class="sh-stat-val">${excAssignments.length}</div>
      <div class="sh-stat-label">Excused</div>
    </div>`;
  }
  if (lateAssignments.length > 0) {
    html += `<div class="sh-stat" title="${lateAssignments.map(t => esc(t)).join('\n')}">
      <div class="sh-stat-val" style="color:var(--score-2)">${lateAssignments.length}</div>
      <div class="sh-stat-label">Late</div>
    </div>`;
  }
  html += `</div>`; // end sh-stats
  if (opts.buttonLabel && opts.buttonHref) {
    html += `<a class="page-toggle-btn" href="${opts.buttonHref}">${esc(opts.buttonLabel)}</a>`;
  }
  html += `</div>`; // end sh-row1

  // Row 2: metadata chips
  const chips = [];
  if (student.studentNumber) chips.push(`<span class="sh-chip"><em class="sh-chip-icon">#</em> ${esc(student.studentNumber)}</span>`);
  if (student.dateOfBirth) chips.push(`<span class="sh-chip">${formatDate(student.dateOfBirth)}</span>`);
  if (student.email) chips.push(`<span class="sh-chip">${esc(student.email)}</span>`);
  if (att.length > 0) {
    let attParts = [`${attPresent} present`];
    if (attAbsent > 0) attParts.push(`${attAbsent} absent`);
    if (attLate > 0) attParts.push(`${attLate} late`);
    chips.push(`<span class="sh-chip">${attParts.join(' \u00b7 ')}</span>`);
  }
  const desigs = student.designations || [];
  let hasIep = false, hasMod = false;
  desigs.forEach(code => {
    const d = BC_DESIGNATIONS[code];
    if (!d) return;
    chips.push(`<span class="sh-chip sh-chip-desig${d.level > 0 ? ' low-inc' : ''}" title="${code} \u2014 ${d.name}${d.iep ? ' \u00b7 IEP Required' : ''}${d.modified ? ' \u00b7 Modified Program' : ''}"><strong>${code}</strong> ${d.name}</span>`);
    if (d.iep) hasIep = true;
    if (d.modified) hasMod = true;
  });
  if (hasIep) chips.push(`<span class="sh-chip sh-chip-iep">IEP</span>`);
  if (hasMod) chips.push(`<span class="sh-chip sh-chip-mod">Modified</span>`);
  chips.push(`<span class="sh-chip">${completionPct}% complete</span>`);
  if (chips.length > 0) {
    html += `<div class="sh-row2">${chips.join('')}</div>`;
  }
  html += `</div>`; // end student-header-top
  return html;
}

/* ── Shared HTML: Sidebar ───────────────────────────────────── */
function _avatarColor(sid) { let h = 0; for (let i = 0; i < sid.length; i++) h = ((h << 5) - h + sid.charCodeAt(i)) | 0; return _AVATAR_COLORS[Math.abs(h) % _AVATAR_COLORS.length]; }

function renderSidebar(activeCourse, selectedStudentId, onStudentClick) {
  _sidebarClickFnName = onStudentClick || null;
  const cid = activeCourse;
  const courseName = COURSES[cid] ? COURSES[cid].name : cid;
  const students = sortStudents(getStudents(cid), 'lastName');

  let html = `<aside id="gb-sidebar" aria-label="Student roster">
    <div id="gb-sidebar-top">
      <select id="gb-course-select" onchange="if(window._pageSwitchCourse)window._pageSwitchCourse(this.value)" aria-label="Select course">
        ${Object.values(COURSES).map(c => `<option value="${c.id}"${c.id===cid?' selected':''}>${esc(c.name)}</option>`).join('')}
      </select>
      <input id="gb-roster-search" type="text" placeholder="Search..." oninput="filterRoster()" aria-label="Search students">
    </div>
    <div id="gb-roster-list" role="list">`;

  const flags = getFlags(cid);
  students.forEach(s => {
    const href = `#/student?id=${s.id}&course=${cid}`;
    const flagged = flags[s.id];
    const avatarBg = _avatarColor(s.id);
    const clickAttr = onStudentClick
      ? `href="javascript:void(0)" data-action="sidebarStudentClick" data-sid="${s.id}"`
      : `href="${href}"`;
    html += `<a class="student-row${s.id===selectedStudentId?' selected':''}" ${clickAttr} data-sid="${s.id}">
      <div class="student-avatar" style="background:${avatarBg}">${initials(s)}</div>
      <div class="student-info">
        <div class="student-row-name">${flagged ? '<span style="color:var(--priority);margin-right:3px">\u2691</span>' : ''}${esc(fullName(s))}</div>
      </div>
      <div class="student-row-prof" data-prof-sid="${s.id}"></div>
    </a>`;
  });

  html += `</div>
    <div id="gb-sidebar-foot">
      <button data-action="addStudent">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="6" y1="2" x2="6" y2="10"/><line x1="2" y1="6" x2="10" y2="6"/></svg>
        Add Student
      </button>
      <span class="sb-count">${students.length} students</span>
    </div>
  </aside>`;
  // Auto-fill badges after caller mounts this HTML
  setTimeout(function() { fillSidebarBadges(cid); }, 0);
  return html;
}

/** Fill sidebar proficiency badges asynchronously after sidebar is mounted. */
function fillSidebarBadges(cid) {
  requestAnimationFrame(function() {
    document.querySelectorAll('[data-prof-sid]').forEach(function(el) {
      var sid = el.getAttribute('data-prof-sid');
      var overall = getOverallProficiency(cid, sid);
      if (overall > 0) {
        var r = Math.round(overall);
        el.style.color = PROF_COLORS[r] || PROF_COLORS[0];
        el.style.background = PROF_TINT[r] || 'transparent';
        el.textContent = overall.toFixed(1);
      }
    });
  });
}

function filterRoster() {
  const q = (document.getElementById('gb-roster-search').value||'').toLowerCase().trim();
  document.querySelectorAll('.student-row').forEach(row => {
    const name = row.querySelector('.student-row-name')?.textContent?.toLowerCase() || '';
    row.style.display = (!q || name.includes(q)) ? '' : 'none';
  });
}

/* ── Proficiency badge HTML ─────────────────────────────────── */
function profBadge(score, size) {
  const s = Math.round(score);
  const sz = size || 'sm';
  return `<span class="prof-badge prof-${s} prof-${sz}">${s || '\u2014'}</span>`;
}

function profBar(value, max, color) {
  const pct = max > 0 ? (value / max * 100) : 0;
  return `<div class="prof-bar"><div class="prof-bar-fill" style="width:${pct}%;background:${color||'var(--active)'}"></div></div>`;
}

// Proficiency label badge (shows word instead of number)
function profLabelBadge(score) {
  const s = Math.round(score);
  return `<span class="prof-label prof-${s}">${s > 0 ? PROF_LABELS[s] : '\u2014'}</span>`;
}

// Refresh sidebar in place (call after score changes)
function refreshSidebar() {
  const mount = document.getElementById('sidebar-mount');
  if (!mount) return;
  const cid = typeof activeCourse !== 'undefined' ? activeCourse : getActiveCourse();
  const clickFn = _sidebarClickFnName || null;
  // Use focusStudentId if available (assignments page), otherwise parse from selected row href
  let selId = typeof focusStudentId !== 'undefined' ? focusStudentId : null;
  if (!selId) {
    const sel = document.querySelector('.student-row.selected');
    if (sel) {
      // Support both hash routes (#/student?id=x) and data-sid attributes
      const sid = sel.dataset.sid;
      if (sid) { selId = sid; }
      else if (sel.href) {
        try {
          const hrefStr = sel.getAttribute('href') || '';
          const qIdx = hrefStr.indexOf('?');
          if (qIdx >= 0) { selId = new URLSearchParams(hrefStr.substring(qIdx + 1)).get('id'); }
        } catch {}
      }
    }
  }
  mount.innerHTML = renderSidebar(cid, selId, clickFn);
}

/* ── Collapsible sidebar (shared across all pages) ─────────── */
let _sidebarVisible = true;
try { _sidebarVisible = localStorage.getItem('gb-sidebar-vis') !== 'false'; } catch {}

function toggleSidebar() {
  _sidebarVisible = !_sidebarVisible;
  localStorage.setItem('gb-sidebar-vis', _sidebarVisible);
  applySidebarState();
}

function applySidebarState() {
  const layout = document.getElementById('page-layout');
  if (!layout) return;
  layout.classList.toggle('sidebar-hidden', !_sidebarVisible);
}

function initSidebarToggle() {
  applySidebarState();
}

/* ── Delete Student (removes all associated data, returns snapshot for undo) ── */
function deleteStudent(cid, sid) {
  const students = getStudents(cid);
  const student = students.find(s => s.id === sid);
  const scores = getScores(cid);
  const goals = getGoals(cid);
  const reflections = getReflections(cid);
  const notes = getNotes(cid);
  const flags = getFlags(cid);
  const statuses = getAssignmentStatuses(cid);

  // Save snapshot for undo
  const snapshot = {
    student,
    scores: scores[sid] ? structuredClone(scores[sid]) : [],
    goals: goals[sid] ? structuredClone(goals[sid]) : undefined,
    reflections: reflections[sid] ? structuredClone(reflections[sid]) : undefined,
    notes: notes[sid] ? structuredClone(notes[sid]) : undefined,
    flagged: flags[sid],
    statuses: {},
    quickObs: getQuickObs(cid)[sid] ? structuredClone(getQuickObs(cid)[sid]) : undefined,
    termRatings: getTermRatings(cid)[sid] ? structuredClone(getTermRatings(cid)[sid]) : undefined
  };
  Object.keys(statuses).forEach(k => { if (k.startsWith(sid + ':')) snapshot.statuses[k] = statuses[k]; });

  // Delete
  saveStudents(cid, students.filter(s => s.id !== sid));
  delete scores[sid]; saveScores(cid, scores);
  delete goals[sid]; saveGoals(cid, goals);
  delete reflections[sid]; saveReflections(cid, reflections);
  delete notes[sid]; saveNotes(cid, notes);
  delete flags[sid]; saveFlags(cid, flags);
  Object.keys(statuses).forEach(k => { if (k.startsWith(sid + ':')) delete statuses[k]; });
  saveAssignmentStatuses(cid, statuses);

  // Clean up quick-obs for the student
  const obs = getQuickObs(cid);
  delete obs[sid]; saveQuickObs(cid, obs);

  // Clean up term-ratings for the student
  const tr = getTermRatings(cid);
  delete tr[sid]; saveTermRatings(cid, tr);

  // Clean student from assignment collaboration data (pairs, groups, excludedStudents)
  const assessments = getAssessments(cid);
  let changed = false;
  assessments.forEach(a => {
    if (a.excludedStudents) { a.excludedStudents = a.excludedStudents.filter(id => id !== sid); if (a.excludedStudents.length === 0) delete a.excludedStudents; changed = true; }
    if (a.pairs) { a.pairs = a.pairs.map(p => p.filter(id => id !== sid)).filter(p => p.length > 0); if (a.pairs.length === 0) delete a.pairs; changed = true; }
    if (a.groups) { a.groups = a.groups.map(g => g.filter(id => id !== sid)).filter(g => g.length > 0); if (a.groups.length === 0) delete a.groups; changed = true; }
  });
  if (changed) saveAssessments(cid, assessments);

  return snapshot;
}

/* ── Undo Toast ───────────────────────────────────────────── */
let _undoState = null;
let _undoTimer = null;

function showUndoToast(message, undoFn) {
  // Clear any existing toast
  dismissUndoToast();

  _undoState = { fn: undoFn };

  const toast = document.createElement('div');
  toast.className = 'undo-toast';
  toast.id = 'undo-toast';
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  toast.innerHTML = `<span>${esc(message)}</span><button class="undo-toast-btn" data-action="executeUndo">Undo</button>`;
  document.body.appendChild(toast);

  _undoTimer = setTimeout(dismissUndoToast, 5000);
}

function executeUndo() {
  if (_undoState && _undoState.fn) {
    _undoState.fn();
  }
  dismissUndoToast();
}

function dismissUndoToast() {
  clearTimeout(_undoTimer);
  _undoState = null;
  const el = document.getElementById('undo-toast');
  if (el) el.remove();
}

/* ── Sync Toast ──────────────────────────────────────────── */
let _syncToastTimer = null;

function showSyncToast(message, type) {
  dismissSyncToast();
  const toast = document.createElement('div');
  toast.className = 'sync-toast ' + (type || 'error');
  toast.id = 'sync-toast';
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  if (type === 'error') {
    toast.innerHTML = `<span>${esc(message)}</span><button class="sync-toast-btn" data-action="retry-sync">Retry Now</button>`;
  } else {
    toast.innerHTML = `<span>${esc(message)}</span>`;
    _syncToastTimer = setTimeout(dismissSyncToast, 3000);
  }
  document.body.appendChild(toast);
}

function dismissSyncToast() {
  clearTimeout(_syncToastTimer);
  const el = document.getElementById('sync-toast');
  if (el) el.remove();
}

/* ── Confirm Modal ────────────────────────────────────────── */
function showConfirm(title, message, okLabel, okStyle, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'confirm-title');
  overlay.innerHTML = `<div class="confirm-card">
    <div class="confirm-title" id="confirm-title">${esc(title)}</div>
    <div class="confirm-message">${esc(message)}</div>
    <div class="confirm-actions">
      <button class="confirm-cancel" id="confirm-cancel-btn">Cancel</button>
      <button class="confirm-ok ${okStyle || 'primary'}" id="confirm-ok-btn">${esc(okLabel || 'OK')}</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  // Focus the cancel button for keyboard users
  overlay.querySelector('#confirm-cancel-btn').focus();
  // Shared cleanup: remove overlay + escHandler + trapHandler in all close paths
  function closeOverlay() { overlay.remove(); document.removeEventListener('keydown', escHandler); document.removeEventListener('keydown', trapHandler); }
  overlay.querySelector('#confirm-ok-btn').onclick = () => { closeOverlay(); onConfirm(); };
  overlay.querySelector('#confirm-cancel-btn').onclick = () => { closeOverlay(); };
  // Close on backdrop click
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });
  // Close on Escape
  const escHandler = (e) => { if (e.key === 'Escape') closeOverlay(); };
  document.addEventListener('keydown', escHandler);
  // Focus trap
  const trapHandler = (e) => {
    if (e.key !== 'Tab') return;
    const focusable = overlay.querySelectorAll('button');
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', trapHandler);
}

/* ── Shared delegated click handler for gb-ui.js components ── */
var _sidebarClickFnName = null;

document.addEventListener('click', function(e) {
  var el = e.target.closest('[data-action]');
  if (!el) return;
  var action = el.dataset.action;
  var handlers = {
    'toggleUserMenu': function() { el.parentElement.classList.toggle('open'); },
    'signOut': function() { signOut(); },
    'deleteAccount': function() {
      showConfirm('Delete All Data',
        'This permanently deletes ALL your data — every class, every student, every score, every observation. Your login account will remain but all data will be erased. This cannot be undone.',
        'Delete Everything', 'danger', async function() {
          try {
            // Delete all course data from Supabase
            const sb = typeof getSupabase === 'function' ? getSupabase() : null;
            if (sb) {
              const user = await getCurrentUser();
              if (user) {
                await sb.from('course_data').delete().eq('teacher_id', user.id);
                await sb.from('teacher_config').delete().eq('teacher_id', user.id);
                await sb.from('error_logs').delete().eq('teacher_id', user.id);
                await sb.from('profiles').delete().eq('id', user.id);
              }
            }
            // Clear localStorage and mark as deliberately wiped (prevents re-seeding)
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key && key.startsWith('gb-')) keysToRemove.push(key);
            }
            keysToRemove.forEach(k => localStorage.removeItem(k));
            localStorage.setItem('gb-data-wiped', '1');
            // Sign out and redirect to login page (separate page, not SPA)
            if (sb) await sb.auth.signOut();
            window.location.href = 'login.html'; // intentional full navigation to login
          } catch(err) {
            alert('Account deletion failed: ' + (err.message || 'Unknown error. Contact your administrator.'));
          }
        }
      );
    },
    'toggleSidebar': function() { toggleSidebar(); },
    'sidebarStudentClick': function() {
      if (!_sidebarClickFnName) return;
      // Support dot-path names like 'PageStudent.switchStudent'
      var parts = _sidebarClickFnName.split('.');
      var fn = window;
      for (var i = 0; i < parts.length; i++) { fn = fn ? fn[parts[i]] : null; }
      if (typeof fn === 'function') fn(el.dataset.sid);
    },
    'addStudent': function() {
      if (typeof openClassManager === 'function') openClassManager();
      else Router.navigate('/dashboard');
    },
    'executeUndo': function() { executeUndo(); }
  };
  if (handlers[action]) {
    e.preventDefault();
    handlers[action]();
  }
});

// Check for Service Worker updates on page load
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    var el = document.getElementById('sync-toast');
    if (el) el.remove();
    var toast = document.createElement('div');
    toast.className = 'sync-toast success';
    toast.id = 'sync-toast';
    toast.setAttribute('role', 'alert');
    toast.innerHTML = '<span>Update available</span><button class="sync-toast-btn" data-action="reload-page">Refresh</button>';
    document.body.appendChild(toast);
  });
}

// Delegated click handler for sync toast and SW update buttons
document.addEventListener('click', function(e) {
  var btn = e.target.closest('[data-action]');
  if (!btn) return;
  switch (btn.dataset.action) {
    case 'retry-sync':
      if (typeof retrySyncs === 'function') retrySyncs();
      dismissSyncToast();
      break;
    case 'reload-page':
      window.location.reload();
      break;
  }
});

// Global error monitoring — cache teacher_id synchronously from the data layer
function _getTeacherId() {
  try { return typeof _teacherId !== 'undefined' ? _teacherId : null; } catch(e) { return null; }
}

window.addEventListener('error', function(event) {
  const sb = typeof getSupabase === 'function' ? getSupabase() : null;
  if (!sb) return;
  sb.from('error_logs').insert({
    teacher_id: _getTeacherId(),
    page: window.location.pathname,
    message: event.message || 'Unknown error',
    stack: event.error ? event.error.stack : '',
    user_agent: navigator.userAgent
  }).then(() => {}).catch(() => {}); // fire and forget
});

window.addEventListener('unhandledrejection', function(event) {
  const sb = typeof getSupabase === 'function' ? getSupabase() : null;
  if (!sb) return;
  sb.from('error_logs').insert({
    teacher_id: _getTeacherId(),
    page: window.location.pathname,
    message: event.reason ? (event.reason.message || String(event.reason)) : 'Unhandled rejection',
    stack: event.reason ? (event.reason.stack || '') : '',
    user_agent: navigator.userAgent
  }).then(() => {}).catch(() => {});
});

/* ── Namespace ──────────────────────────────────────────────── */
window.UI = {
  renderDock,
  getUpcomingBirthdays,
  renderStudentHeader,
  renderSidebar,
  fillSidebarBadges,
  filterRoster,
  profBadge,
  profBar,
  profLabelBadge,
  refreshSidebar,
  toggleSidebar,
  applySidebarState,
  initSidebarToggle,
  deleteStudent,
  showUndoToast,
  executeUndo,
  dismissUndoToast,
  showSyncToast,
  dismissSyncToast,
  showConfirm,
};
