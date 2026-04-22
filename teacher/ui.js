/* gb-ui.js — Shared UI components for FullVision */

/* ── HTML sanitizer for contenteditable output ──────────────── */
function sanitizeHtml(raw) {
  var allowed = ['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'BR', 'P', 'DIV', 'SPAN'];
  var tmp = document.createElement('div');
  tmp.innerHTML = raw;
  (function walk(node) {
    for (var i = node.childNodes.length - 1; i >= 0; i--) {
      var child = node.childNodes[i];
      if (child.nodeType === 1) {
        if (allowed.indexOf(child.tagName) === -1) {
          child.replaceWith(document.createTextNode(child.textContent));
        } else {
          [].slice.call(child.attributes).forEach(function (a) {
            child.removeAttribute(a.name);
          });
          walk(child);
        }
      }
    }
  })(tmp);
  return tmp.innerHTML;
}

/* ── Shared HTML: Unified Toolbar ──────────────────────────── */
const OFFLINE_BANNER_COPY = "You're offline. Changes will sync when connection returns.";
let _syncUIBound = false;
let _syncUIUnsubscribe = null;
let _sessionExpiredRetries = {};
let _sessionExpiredCopyDraft = null;
let _sessionExpiredModalOpen = false;

function renderDock(activePage, rightHTML) {
  _ensureSyncStatusUI();
  const ap = activePage === 'student' ? 'dashboard' : activePage;
  const seg = TB_PAGES.map(
    p => `<a href="${p.href}" class="tb-seg-link${p.id === ap ? ' tb-seg-active' : ''}">${p.label}</a>`,
  ).join('');

  const userMenu = `<div class="tb-user-menu">
    <div class="tb-sync-anchor">
      <button class="tb-sync-badge obs-badge" id="tb-sync-badge" data-action="toggleSyncPopover" title="View sync status" aria-label="View sync status" aria-expanded="false" hidden>0</button>
      <div class="tb-sync-popover" id="tb-sync-popover" hidden></div>
    </div>
    <button class="tb-user-btn" data-action="toggleUserMenu" title="Account" aria-label="Account menu" aria-expanded="false" aria-haspopup="true">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="5" r="3"/><path d="M2 14c0-3 2.5-5 6-5s6 2 6 5"/></svg>
      <span class="tb-user-name" id="tb-user-name"></span>
    </button>
    <div class="tb-user-dropdown">
      <button class="tb-user-signout" data-action="signOut">Sign Out</button>
      <div style="border-top:1px solid var(--border);margin-top:4px;padding-top:4px">
        <button class="tb-user-delete" data-action="deleteAccount" style="font-size:var(--text-xs);color:var(--score-1);background:none;border:none;cursor:pointer;padding:4px 8px;width:100%;text-align:left">Delete Account</button>
      </div>
    </div>
  </div>`;

  return `<div class="offline-banner" id="offline-banner" role="status" aria-live="polite" hidden>${OFFLINE_BANNER_COPY}</div>
  <nav id="app-dock" role="navigation" aria-label="Main navigation">
    <div class="tb-group tb-left">
      <button class="tb-btn" data-action="toggleSidebar" title="Toggle Sidebar" aria-label="Toggle Sidebar">${TB_SIDEBAR_SVG}</button>
    </div>
    <div class="tb-group tb-center">
      <div class="tb-seg">${seg}</div>
    </div>
    <div class="tb-group tb-right">${rightHTML || ''}<div class="tb-sync" role="status" aria-label="Sync status"><div class="tb-sync-dot idle" id="sync-indicator-dot" title="All changes saved" aria-label="All changes saved"></div></div>${userMenu}</div>
  </nav>`;
}

function _getQueueStats() {
  if (!window.v2Queue || typeof window.v2Queue.stats !== 'function') {
    return { queued: 0, deadLettered: 0, lastFlushAt: null, online: navigator.onLine !== false, flushing: false };
  }
  var stats = window.v2Queue.stats() || {};
  return {
    queued: Number(stats.queued || 0),
    deadLettered: Number(stats.deadLettered || 0),
    lastFlushAt: stats.lastFlushAt || null,
    online: stats.online !== false,
    flushing: !!stats.flushing,
  };
}

function _getUnsyncedCount(stats) {
  return Number(stats.queued || 0) + Number(stats.deadLettered || 0);
}

function _formatRelativeTime(iso) {
  if (!iso) return 'Not yet';
  var ts = Date.parse(iso);
  if (!ts) return 'Unknown';
  var diffMs = Date.now() - ts;
  if (diffMs < 60000) return 'Just now';
  var diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) return diffMin === 1 ? '1 minute ago' : diffMin + ' minutes ago';
  var diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return diffHr === 1 ? '1 hour ago' : diffHr + ' hours ago';
  var diffDay = Math.round(diffHr / 24);
  return diffDay === 1 ? '1 day ago' : diffDay + ' days ago';
}

function _humanizeEndpoint(endpoint) {
  return (endpoint || 'queued write')
    .replace(/^v2\./, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, function (c) {
      return c.toUpperCase();
    });
}

function _renderSyncDeadEntry(entry) {
  var label = _humanizeEndpoint(entry && entry.endpoint);
  var error = (entry && entry.last_error) || 'Retry failed';
  return `<div class="tb-sync-dead-item">
    <div class="tb-sync-dead-copy">
      <div class="tb-sync-dead-title">${esc(label)}</div>
      <div class="tb-sync-dead-error">${esc(error)}</div>
    </div>
    <button class="tb-sync-dead-dismiss" data-action="dismissSyncDeadLetter" data-id="${esc((entry && entry.id) || '')}">Dismiss</button>
  </div>`;
}

function _renderSyncPopoverContent(stats) {
  var total = _getUnsyncedCount(stats);
  var dead = window.v2Queue && typeof window.v2Queue.deadLetter === 'function' ? window.v2Queue.deadLetter() : [];
  var summary = total > 0 ? total + ' unsynced' : 'All changes saved';
  var pendingCopy = stats.queued === 1 ? '1 pending write' : stats.queued + ' pending writes';
  var deadCopy = stats.deadLettered === 1 ? '1 needs attention' : stats.deadLettered + ' need attention';
  var meta = [pendingCopy];
  if (stats.deadLettered > 0) meta.push(deadCopy);
  var deadHtml = dead.length
    ? `<div class="tb-sync-dead-list">${dead.map(_renderSyncDeadEntry).join('')}</div>`
    : `<div class="tb-sync-empty">No failed sync items.</div>`;
  return `<div class="tb-sync-popover-card">
    <div class="tb-sync-popover-header">
      <div>
        <div class="tb-sync-popover-title">${esc(summary)}</div>
        <div class="tb-sync-popover-meta">${esc(meta.join(' · '))}</div>
      </div>
      <button class="tb-sync-action" data-action="retrySyncQueue">Retry</button>
    </div>
    <div class="tb-sync-popover-row">
      <span>Connection</span>
      <strong>${stats.online ? 'Online' : 'Offline'}</strong>
    </div>
    <div class="tb-sync-popover-row">
      <span>Last sync</span>
      <strong>${esc(_formatRelativeTime(stats.lastFlushAt))}</strong>
    </div>
    <div class="tb-sync-popover-section">Needs attention</div>
    ${deadHtml}
  </div>`;
}

function _setSyncPopoverOpen(isOpen) {
  var popover = document.getElementById('tb-sync-popover');
  var badge = document.getElementById('tb-sync-badge');
  if (!popover) return;
  popover.hidden = !isOpen;
  popover.classList.toggle('open', !!isOpen);
  if (badge) badge.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function _closeSyncPopover() {
  _setSyncPopoverOpen(false);
}

function refreshSyncStatusUI() {
  var stats = _getQueueStats();
  var total = _getUnsyncedCount(stats);
  var badge = document.getElementById('tb-sync-badge');
  var popover = document.getElementById('tb-sync-popover');
  var banner = document.getElementById('offline-banner');
  var dot = document.getElementById('sync-indicator-dot');
  var body = document.body;

  if (banner) {
    banner.hidden = !!stats.online;
  }
  if (body && body.classList && typeof body.classList.toggle === 'function') {
    body.classList.toggle('offline-active', !stats.online);
  }

  if (badge) {
    var label = total === 1 ? '1 unsynced change' : total + ' unsynced changes';
    if (stats.deadLettered > 0) {
      label += ' including ' + (stats.deadLettered === 1 ? '1 failed item' : stats.deadLettered + ' failed items');
    }
    badge.hidden = total <= 0;
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.title = label;
    badge.setAttribute('aria-label', label);
  }

  if (popover) {
    popover.innerHTML = _renderSyncPopoverContent(stats);
  }

  if (dot) {
    var dotStatus = 'idle';
    var dotTitle = 'All changes saved';
    if (stats.deadLettered > 0) {
      dotStatus = 'error';
      dotTitle =
        stats.deadLettered === 1 ? '1 sync item needs attention' : stats.deadLettered + ' sync items need attention';
    } else if (!stats.online && total > 0) {
      dotStatus = 'error';
      dotTitle = total === 1 ? 'Offline — 1 change queued' : 'Offline — ' + total + ' changes queued';
    } else if (stats.flushing || (stats.online && stats.queued > 0)) {
      dotStatus = 'syncing';
      dotTitle = stats.queued === 1 ? 'Syncing 1 queued change' : 'Syncing ' + stats.queued + ' queued changes';
    }
    dot.className = 'tb-sync-dot ' + dotStatus;
    dot.title = dotTitle;
    dot.setAttribute('aria-label', dotTitle);
  }
}

function _ensureSyncStatusUI() {
  if (_syncUIBound) return;
  _syncUIBound = true;
  if (window.v2Queue && typeof window.v2Queue.subscribe === 'function') {
    _syncUIUnsubscribe = window.v2Queue.subscribe(function () {
      refreshSyncStatusUI();
    });
  }
  window.addEventListener('online', refreshSyncStatusUI);
  window.addEventListener('offline', refreshSyncStatusUI);
}

async function retrySyncQueue() {
  if (!window.v2Queue || typeof window.v2Queue.flush !== 'function') return;
  var result = await window.v2Queue.flush();
  refreshSyncStatusUI();
  if (typeof showSyncToast === 'function') {
    if (result && result.deadLettered > 0) showSyncToast('Some queued changes still need attention.', 'error');
    else if (result && result.succeeded > 0) showSyncToast('Queued changes synced.', 'success');
  }
}

function _getLocalStorageKeys() {
  if (!localStorage) return [];
  if (typeof localStorage.length === 'number' && typeof localStorage.key === 'function') {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      keys.push(localStorage.key(i));
    }
    return keys.filter(Boolean);
  }
  if (localStorage._store) return Object.keys(localStorage._store);
  return Object.keys(localStorage).filter(function (key) {
    return typeof localStorage[key] !== 'function';
  });
}

function _getStoredAuthEmail() {
  var keys = _getLocalStorageKeys();
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (!/^sb-.*-auth-token$/.test(key || '')) continue;
    try {
      var parsed = JSON.parse(localStorage.getItem(key) || 'null') || {};
      var email =
        (parsed.user && parsed.user.email) ||
        (parsed.currentSession && parsed.currentSession.user && parsed.currentSession.user.email) ||
        (parsed.session && parsed.session.user && parsed.session.user.email) ||
        '';
      if (email) return email;
    } catch (e) {
      /* ignore malformed auth cache */
    }
  }
  return '';
}

function _clearSessionExpiredState() {
  _sessionExpiredRetries = {};
  _sessionExpiredCopyDraft = null;
  _sessionExpiredModalOpen = false;
}

function _copySessionExpiredDraft() {
  if (!_sessionExpiredCopyDraft) return Promise.resolve(false);
  var text = (_sessionExpiredCopyDraft() || '').trim();
  if (!text) return Promise.resolve(false);
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text).then(
      function () {
        return true;
      },
      function () {
        return false;
      },
    );
  }
  return Promise.resolve(false);
}

function _showSessionExpiredDraftToast() {
  dismissSyncToast();
  var toast = document.createElement('div');
  toast.className = 'sync-toast error';
  toast.id = 'sync-toast';
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  toast.innerHTML =
    '<span>Session expired. Copy your draft before it is lost.</span><button class="sync-toast-btn" data-action="copy-session-draft">Copy Draft</button>';
  document.body.appendChild(toast);
}

function queueSessionExpiredRetry(opts) {
  opts = opts || {};
  if (typeof opts.retry !== 'function') return;
  var key = opts.key || 'default';
  _sessionExpiredRetries[key] = opts.retry;
  if (typeof opts.getDraftText === 'function') {
    _sessionExpiredCopyDraft = opts.getDraftText;
  }
  if (_sessionExpiredModalOpen) return;
  _sessionExpiredModalOpen = true;

  var email = opts.email || _getStoredAuthEmail();
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.id = 'session-expired-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'session-expired-title');
  overlay.innerHTML = `<div class="modal-box session-expired-modal">
    <div class="confirm-title" id="session-expired-title">Session Expired</div>
    <div class="confirm-message">Enter your password to keep working without losing this draft.</div>
    <div class="confirm-form">
      <label class="confirm-field">
        <span class="confirm-label">Email</span>
        <input class="confirm-input" id="session-expired-email" type="email" value="${esc(email)}" autocomplete="email">
      </label>
      <label class="confirm-field">
        <span class="confirm-label">Password</span>
        <input class="confirm-input" id="session-expired-password" type="password" autocomplete="current-password" placeholder="Current password">
      </label>
    </div>
    <div class="session-expired-note">Your draft stays on screen while you reconnect.</div>
    <div class="confirm-error" id="session-expired-error" aria-live="polite"></div>
    <div class="session-expired-actions">
      <button class="confirm-cancel" id="session-expired-cancel">Not now</button>
      <button class="confirm-ok primary" id="session-expired-submit">Continue</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  var emailInput = overlay.querySelector('#session-expired-email');
  var passwordInput = overlay.querySelector('#session-expired-password');
  var errorEl = overlay.querySelector('#session-expired-error');
  var cancelBtn = overlay.querySelector('#session-expired-cancel');
  var submitBtn = overlay.querySelector('#session-expired-submit');

  function closeModal(showDraftToast) {
    overlay.remove();
    _sessionExpiredModalOpen = false;
    if (showDraftToast) _showSessionExpiredDraftToast();
  }

  cancelBtn.onclick = function () {
    _sessionExpiredRetries = {};
    closeModal(true);
  };

  overlay.addEventListener('click', function (evt) {
    if (evt.target === overlay) {
      _sessionExpiredRetries = {};
      closeModal(true);
    }
  });

  submitBtn.onclick = async function () {
    errorEl.textContent = '';
    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    try {
      await signIn(emailInput.value.trim(), passwordInput.value);
      var retryKeys = Object.keys(_sessionExpiredRetries);
      for (var i = 0; i < retryKeys.length; i++) {
        var res = await _sessionExpiredRetries[retryKeys[i]]();
        if (res && res.error) throw res.error.sourceError || res.error;
      }
      _clearSessionExpiredState();
      overlay.remove();
      if (typeof showSyncToast === 'function') {
        showSyncToast('Session restored. Draft saved.', 'success');
      }
    } catch (err) {
      errorEl.textContent = (err && err.message) || 'Could not restore your session.';
      submitBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  };

  passwordInput.focus();
}

/* ── Populate user display name in dock ────────────────────── */
function _populateDockUser() {
  const el = document.getElementById('tb-user-name');
  if (!el || typeof getSupabase !== 'function') return;
  getSupabase()
    .auth.getSession()
    .then(({ data: { session } }) => {
      if (!session) return;
      const user = session.user;
      const name = user.user_metadata?.display_name || user.email?.split('@')[0] || 'User';
      el.textContent = name;
    })
    .catch(err => {
      console.warn('Could not load user session for dock:', err);
      el.textContent = 'User';
    });
}
// Run after DOM renders (next tick)
setTimeout(_populateDockUser, 0);

/* ── Prefetch (disabled in SPA — all modules already loaded) ── */

// Close user dropdown on click outside
document.addEventListener('click', function (e) {
  const menu = document.querySelector('.tb-user-menu');
  if (menu && !menu.contains(e.target)) {
    menu.classList.remove('open');
    const button = menu.querySelector('.tb-user-btn');
    if (button) button.setAttribute('aria-expanded', 'false');
    _closeSyncPopover();
  }
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
  allScores.forEach(s => {
    if (s.score > 0) scoredAssessments.add(s.assessmentId);
  });
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
  const nsAssignments = [],
    excAssignments = [],
    lateAssignments = [];
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
  if (typeof getCourseLetterData === 'function' && courseShowsLetterGrades(course) && overall > 0) {
    const lg = getCourseLetterData(cid, student.id);
    html += `<div class="letter-card">
      <div class="letter-val">${lg && lg.S ? lg.S : '—'}</div>
      <div class="letter-pct">${lg && lg.R != null ? lg.R + '%' : '—'}</div>
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
  if (student.studentNumber)
    chips.push(`<span class="sh-chip"><em class="sh-chip-icon">#</em> ${esc(student.studentNumber)}</span>`);
  if (student.dateOfBirth) chips.push(`<span class="sh-chip">${formatDate(student.dateOfBirth)}</span>`);
  if (student.email) chips.push(`<span class="sh-chip">${esc(student.email)}</span>`);
  if (att.length > 0) {
    let attParts = [`${attPresent} present`];
    if (attAbsent > 0) attParts.push(`${attAbsent} absent`);
    if (attLate > 0) attParts.push(`${attLate} late`);
    chips.push(`<span class="sh-chip">${attParts.join(' \u00b7 ')}</span>`);
  }
  const desigs = student.designations || [];
  let hasIep = false,
    hasMod = false;
  desigs.forEach(code => {
    const d = BC_DESIGNATIONS[code];
    if (!d) return;
    chips.push(
      `<span class="sh-chip sh-chip-desig${d.level > 0 ? ' low-inc' : ''}" title="${code} \u2014 ${d.name}${d.iep ? ' \u00b7 IEP Required' : ''}${d.modified ? ' \u00b7 Modified Program' : ''}"><strong>${code}</strong> ${d.name}</span>`,
    );
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
function _avatarColor(sid) {
  let h = 0;
  for (let i = 0; i < sid.length; i++) h = ((h << 5) - h + sid.charCodeAt(i)) | 0;
  return _AVATAR_COLORS[Math.abs(h) % _AVATAR_COLORS.length];
}

function renderSidebar(activeCourse, selectedStudentId, onStudentClick) {
  _sidebarClickFnName = onStudentClick || null;
  const cid = activeCourse;
  const courseName = COURSES[cid] ? COURSES[cid].name : cid;
  const students = sortStudents(getStudents(cid), 'lastName');

  let html = `<aside id="gb-sidebar" aria-label="Student roster">
    <div id="gb-sidebar-top">
      <select id="gb-course-select" onchange="if(window._pageSwitchCourse)window._pageSwitchCourse(this.value)" aria-label="Select course">
        ${Object.values(COURSES)
          .map(c => `<option value="${c.id}"${c.id === cid ? ' selected' : ''}>${esc(c.name)}</option>`)
          .join('')}
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
    html += `<a class="student-row${s.id === selectedStudentId ? ' selected' : ''}" ${clickAttr} data-sid="${s.id}">
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
  setTimeout(function () {
    fillSidebarBadges(cid);
  }, 0);
  return html;
}

/** Fill sidebar proficiency badges asynchronously after sidebar is mounted. */
function fillSidebarBadges(cid) {
  requestAnimationFrame(function () {
    document.querySelectorAll('[data-prof-sid]').forEach(function (el) {
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
  const q = (document.getElementById('gb-roster-search').value || '').toLowerCase().trim();
  document.querySelectorAll('.student-row').forEach(row => {
    const name = row.querySelector('.student-row-name')?.textContent?.toLowerCase() || '';
    row.style.display = !q || name.includes(q) ? '' : 'none';
  });
}

/* ── Proficiency badge HTML ─────────────────────────────────── */
function profBadge(score, size) {
  const s = Math.round(score);
  const sz = size || 'sm';
  return `<span class="prof-badge prof-${s} prof-${sz}">${s || '\u2014'}</span>`;
}

function profBar(value, max, color) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return `<div class="prof-bar"><div class="prof-bar-fill" style="width:${pct}%;background:${color || 'var(--active)'}"></div></div>`;
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
      if (sid) {
        selId = sid;
      } else if (sel.href) {
        try {
          const hrefStr = sel.getAttribute('href') || '';
          const qIdx = hrefStr.indexOf('?');
          if (qIdx >= 0) {
            selId = new URLSearchParams(hrefStr.substring(qIdx + 1)).get('id');
          }
        } catch (e) {
          console.warn('Sidebar href parse error:', e);
        }
      }
    }
  }
  mount.innerHTML = renderSidebar(cid, selId, clickFn);
}

/* ── Collapsible sidebar (shared across all pages) ─────────── */
let _sidebarVisible = true;
try {
  _sidebarVisible = localStorage.getItem('gb-sidebar-vis') !== 'false';
} catch (e) {
  console.warn('Sidebar state read error:', e);
}

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
    termRatings: getTermRatings(cid)[sid] ? structuredClone(getTermRatings(cid)[sid]) : undefined,
  };
  Object.keys(statuses).forEach(k => {
    if (k.startsWith(sid + ':')) snapshot.statuses[k] = statuses[k];
  });

  // Delete
  saveStudents(
    cid,
    students.filter(s => s.id !== sid),
  );
  delete scores[sid];
  saveScores(cid, scores);
  delete goals[sid];
  saveGoals(cid, goals);
  delete reflections[sid];
  saveReflections(cid, reflections);
  delete notes[sid];
  saveNotes(cid, notes);
  delete flags[sid];
  saveFlags(cid, flags);
  Object.keys(statuses).forEach(k => {
    if (k.startsWith(sid + ':')) delete statuses[k];
  });
  saveAssignmentStatuses(cid, statuses);

  // Clean up quick-obs for the student
  const obs = getQuickObs(cid);
  delete obs[sid];
  saveQuickObs(cid, obs);

  // Clean up term-ratings for the student
  const tr = getTermRatings(cid);
  delete tr[sid];
  saveTermRatings(cid, tr);

  // Clean student from assignment collaboration data (pairs, groups, excludedStudents)
  const assessments = getAssessments(cid);
  let changed = false;
  assessments.forEach(a => {
    if (a.excludedStudents) {
      a.excludedStudents = a.excludedStudents.filter(id => id !== sid);
      if (a.excludedStudents.length === 0) delete a.excludedStudents;
      changed = true;
    }
    if (a.pairs) {
      a.pairs = a.pairs.map(p => p.filter(id => id !== sid)).filter(p => p.length > 0);
      if (a.pairs.length === 0) delete a.pairs;
      changed = true;
    }
    if (a.groups) {
      a.groups = a.groups.map(g => g.filter(id => id !== sid)).filter(g => g.length > 0);
      if (a.groups.length === 0) delete a.groups;
      changed = true;
    }
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
  var triggerEl = document.activeElement;
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
  function closeOverlay() {
    overlay.remove();
    document.removeEventListener('keydown', escHandler);
    document.removeEventListener('keydown', trapHandler);
    try {
      if (triggerEl && typeof triggerEl.focus === 'function') triggerEl.focus();
    } catch (e) {
      /* trigger may have been removed */
    }
  }
  overlay.querySelector('#confirm-ok-btn').onclick = () => {
    closeOverlay();
    onConfirm();
  };
  overlay.querySelector('#confirm-cancel-btn').onclick = () => {
    closeOverlay();
  };
  // Close on backdrop click
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeOverlay();
  });
  // Close on Escape
  const escHandler = e => {
    if (e.key === 'Escape') closeOverlay();
  };
  document.addEventListener('keydown', escHandler);
  // Focus trap
  const trapHandler = e => {
    if (e.key !== 'Tab') return;
    const focusable = overlay.querySelectorAll('button');
    const first = focusable[0],
      last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', trapHandler);
}

async function softDeleteAccountWithPassword(typedEmail, password) {
  var currentUser = typeof getCurrentUser === 'function' ? await getCurrentUser() : null;
  var expectedEmail = ((currentUser && currentUser.email) || '').trim();
  if (!expectedEmail) throw new Error('Could not verify the current account email.');
  if ((typedEmail || '').trim().toLowerCase() !== expectedEmail.toLowerCase()) {
    throw new Error('Type your account email exactly to confirm deletion.');
  }
  if (!password) throw new Error('Enter your password to confirm deletion.');
  if (typeof reauthenticateWithPassword === 'function') {
    await reauthenticateWithPassword(password);
  }
  if (!window.v2 || typeof window.v2.softDeleteTeacher !== 'function') {
    throw new Error('Delete account is unavailable right now.');
  }
  var result = await window.v2.softDeleteTeacher();
  if (result && result.error) throw result.error;
  await signOut();
}

async function showDeleteAccountDialog() {
  var currentUser = typeof getCurrentUser === 'function' ? await getCurrentUser() : null;
  var email = ((currentUser && currentUser.email) || '').trim();
  if (!email) {
    if (typeof showSyncToast === 'function')
      showSyncToast('Could not load account details. Sign in again and retry.', 'error');
    return;
  }

  var overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'delete-account-title');
  overlay.innerHTML = `<div class="confirm-card">
    <div class="confirm-title" id="delete-account-title">Delete Account</div>
    <div class="confirm-message">Deleting your account hides all your data immediately and permanently removes it after 30 days. You can cancel the deletion by signing in again within 30 days.</div>
    <div class="confirm-help">Type <strong>${esc(email)}</strong> and enter your password to confirm.</div>
    <div class="confirm-form">
      <label class="confirm-field">
        <span class="confirm-label">Email confirmation</span>
        <input class="confirm-input" id="delete-account-email" type="email" autocomplete="email" placeholder="${esc(email)}">
      </label>
      <label class="confirm-field">
        <span class="confirm-label">Password</span>
        <input class="confirm-input" id="delete-account-password" type="password" autocomplete="current-password" placeholder="Current password">
      </label>
    </div>
    <div class="confirm-error" id="delete-account-error" aria-live="polite"></div>
    <div class="confirm-actions">
      <button class="confirm-cancel" id="delete-account-cancel">Cancel</button>
      <button class="confirm-ok danger" id="delete-account-confirm">Delete Account</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  var cancelBtn = overlay.querySelector('#delete-account-cancel');
  var confirmBtn = overlay.querySelector('#delete-account-confirm');
  var emailInput = overlay.querySelector('#delete-account-email');
  var passwordInput = overlay.querySelector('#delete-account-password');
  var errorEl = overlay.querySelector('#delete-account-error');

  function closeOverlay() {
    overlay.remove();
  }

  cancelBtn.onclick = function () {
    closeOverlay();
  };
  overlay.addEventListener('click', function (evt) {
    if (evt.target === overlay) closeOverlay();
  });
  confirmBtn.onclick = async function () {
    errorEl.textContent = '';
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    try {
      await softDeleteAccountWithPassword(emailInput.value, passwordInput.value);
    } catch (err) {
      errorEl.textContent = err && err.message ? err.message : 'Could not delete account.';
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  };
  emailInput.focus();
}

/* ── Shared delegated click handler for gb-ui.js components ── */
var _sidebarClickFnName = null;

document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-action]');
  if (!el) return;
  var action = el.dataset.action;
  var handlers = {
    toggleUserMenu: function () {
      var isOpen = el.parentElement.classList.toggle('open');
      el.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    },
    toggleSyncPopover: function () {
      if (el.hidden) return;
      var popover = document.getElementById('tb-sync-popover');
      if (!popover) return;
      _setSyncPopoverOpen(popover.hidden);
    },
    signOut: function () {
      signOut();
    },
    deleteAccount: async function () {
      await showDeleteAccountDialog();
    },
    toggleSidebar: function () {
      toggleSidebar();
    },
    sidebarStudentClick: function () {
      if (!_sidebarClickFnName) return;
      // Support dot-path names like 'PageStudent.switchStudent'
      var parts = _sidebarClickFnName.split('.');
      var fn = window;
      for (var i = 0; i < parts.length; i++) {
        fn = fn ? fn[parts[i]] : null;
      }
      if (typeof fn === 'function') fn(el.dataset.sid);
    },
    addStudent: function () {
      if (typeof openClassManager === 'function') openClassManager();
      else Router.navigate('/dashboard');
    },
    executeUndo: function () {
      executeUndo();
    },
    retrySyncQueue: async function () {
      await retrySyncQueue();
    },
    dismissSyncDeadLetter: function () {
      if (!window.v2Queue || typeof window.v2Queue.dismissDeadLetter !== 'function') return;
      window.v2Queue.dismissDeadLetter(el.dataset.id);
      refreshSyncStatusUI();
    },
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
    toast.innerHTML =
      '<span>Update available</span><button class="sync-toast-btn" data-action="reload-page">Refresh</button>';
    document.body.appendChild(toast);
  });
}

// Delegated click handler for sync toast and SW update buttons
document.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-action]');
  if (!btn) return;
  switch (btn.dataset.action) {
    case 'retry-sync':
      retrySyncQueue();
      dismissSyncToast();
      break;
    case 'copy-session-draft':
      _copySessionExpiredDraft().then(function (copied) {
        if (copied && typeof showSyncToast === 'function') {
          showSyncToast('Draft copied to clipboard.', 'success');
        }
      });
      dismissSyncToast();
      break;
    case 'reload-page':
      window.location.reload();
      break;
  }
});

// Global error monitoring — cache teacher_id synchronously from the data layer
function _getTeacherId() {
  try {
    return typeof _teacherId !== 'undefined' ? _teacherId : null;
  } catch (e) {
    return null;
  }
}

function _recordClientError(source, details) {
  try {
    var key = 'gb-client-errors';
    var current = JSON.parse(localStorage.getItem(key) || '[]');
    current.push({
      source: source,
      page: window.location.pathname,
      teacher_id: _getTeacherId(),
      created_at: new Date().toISOString(),
      details: details,
    });
    if (current.length > 25) current = current.slice(current.length - 25);
    localStorage.setItem(key, JSON.stringify(current));
  } catch (e) {
    // Storage is best-effort only.
  }
}

window.addEventListener('error', function (event) {
  _recordClientError('error', {
    message: event.message || 'Unknown error',
    stack: event.error ? event.error.stack : '',
    user_agent: navigator.userAgent,
  });
});

window.addEventListener('unhandledrejection', function (event) {
  _recordClientError('unhandledrejection', {
    message: event.reason ? event.reason.message || String(event.reason) : 'Unhandled rejection',
    stack: event.reason ? event.reason.stack || '' : '',
    user_agent: navigator.userAgent,
  });
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
  refreshSyncStatusUI,
  retrySyncQueue,
  queueSessionExpiredRetry,
};
