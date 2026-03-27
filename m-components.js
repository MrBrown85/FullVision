/* m-components.js — Shared iOS-style mobile UI components */

window.MComponents = (function() {
  'use strict';

  /* ── SVG Icons (SF Symbols style) ──────────────────────────── */
  var ICONS = {
    chevronLeft: '<svg width="13" height="20" viewBox="0 0 13 20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2L3 10l8 8"/></svg>',
    chevronRight: '<svg class="m-cell-chevron" width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l5.5 5.5L1 12"/></svg>',
    plus: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    settings: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>'
  };

  /* ── Avatar helper ─────────────────────────────────────────── */
  function avatarColor(id) {
    var hash = 0;
    for (var i = 0; i < id.length; i++) hash = ((hash << 5) - hash) + id.charCodeAt(i);
    return _AVATAR_COLORS[Math.abs(hash) % _AVATAR_COLORS.length];
  }

  function avatarInitials(st) {
    var first = (st.preferred || st.firstName || '').charAt(0);
    var last = (st.lastName || '').charAt(0);
    return (first + last).toUpperCase();
  }

  /* ── Navigation Bar ────────────────────────────────────────── */
  function navBar(opts) {
    var back = '';
    if (opts.backLabel) {
      back = '<button class="m-nav-bar-back" data-action="m-back">' +
        ICONS.chevronLeft + '<span>' + _esc(opts.backLabel) + '</span></button>';
    }
    var actions = '';
    if (opts.rightHTML) {
      actions = '<div class="m-nav-bar-actions">' + opts.rightHTML + '</div>';
    }
    var subtitle = opts.subtitle ? '<div style="font-size:12px;color:var(--text-3);font-weight:400">' + _esc(opts.subtitle) + '</div>' : '';
    return '<div class="m-nav-bar" id="m-nav-bar-' + (opts.id || 'main') + '">' +
      '<div class="m-nav-bar-inner">' +
        back +
        '<div class="m-nav-bar-title-inline">' + _esc(opts.title) + subtitle + '</div>' +
        actions +
      '</div></div>';
  }

  function largeTitleHTML(title) {
    return '<div class="m-title-large">' + _esc(title) + '</div>';
  }

  /* ── Sheet (present / dismiss) ─────────────────────────────── */
  var _sheetCloseCallback = null;

  function presentSheet(html, opts) {
    opts = opts || {};
    var backdrop = document.getElementById('m-sheet-backdrop');
    var container = document.getElementById('m-sheet-container');
    var halfClass = opts.half ? ' m-sheet-half' : '';
    container.innerHTML = '<div class="m-sheet' + halfClass + '">' +
      '<div class="m-sheet-handle"></div>' +
      '<div class="m-sheet-content">' + html + '</div></div>';
    backdrop.style.display = '';
    _sheetCloseCallback = opts.onClose || null;
    requestAnimationFrame(function() {
      backdrop.classList.add('m-sheet-visible');
      container.querySelector('.m-sheet').classList.add('m-sheet-visible');
    });
    backdrop.onclick = dismissSheet;
  }

  function dismissSheet() {
    var backdrop = document.getElementById('m-sheet-backdrop');
    var container = document.getElementById('m-sheet-container');
    var sheet = container.querySelector('.m-sheet');
    if (sheet) sheet.classList.remove('m-sheet-visible');
    backdrop.classList.remove('m-sheet-visible');
    setTimeout(function() {
      backdrop.style.display = 'none';
      container.innerHTML = '';
      if (_sheetCloseCallback) { _sheetCloseCallback(); _sheetCloseCallback = null; }
    }, 350);
  }

  /* ── Toast ──────────────────────────────────────────────────── */
  var _toastTimer = null;

  function showToast(message, opts) {
    opts = opts || {};
    var el = document.getElementById('m-toast');
    var undoBtn = opts.onUndo ? '<button class="m-toast-undo" data-action="m-toast-undo">Undo</button>' : '';
    el.innerHTML = '<div class="m-toast-item"><span>' + _esc(message) + '</span>' + undoBtn + '</div>';
    if (opts.onUndo) {
      el.querySelector('[data-action="m-toast-undo"]').onclick = function() {
        opts.onUndo();
        hideToast();
      };
    }
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(hideToast, opts.duration || 5000);
  }

  function hideToast() {
    clearTimeout(_toastTimer);
    var el = document.getElementById('m-toast');
    el.innerHTML = '';
  }

  /* ── Scroll → large title collapse ─────────────────────────── */
  function setupScrollTitle(screenEl, navBarId) {
    var content = screenEl.querySelector('.m-screen-content');
    var navBar = document.getElementById(navBarId);
    if (!content || !navBar) return;
    content.addEventListener('scroll', function() {
      if (content.scrollTop > 10) {
        navBar.classList.add('m-nav-bar-scrolled');
      } else {
        navBar.classList.remove('m-nav-bar-scrolled');
      }
    }, { passive: true });
  }

  /* ── Haptic feedback (best-effort) ─────────────────────────── */
  function haptic() {
    if (navigator.vibrate) navigator.vibrate(10);
  }

  /* ── Relative time ─────────────────────────────────────────── */
  function relativeTime(isoStr) {
    var d = new Date(isoStr);
    var now = new Date();
    var diff = now - d;
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    if (days < 7) return days + 'd ago';
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  function dateGroupLabel(dateStr) {
    var today = new Date(); today.setHours(0,0,0,0);
    var d = new Date(dateStr); d.setHours(0,0,0,0);
    var diff = Math.round((today - d) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return 'This Week';
    return 'Earlier';
  }

  /* ── HTML escape ───────────────────────────────────────────── */
  function _esc(str) {
    if (!str) return '';
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  /* ── Proficiency color (CSS var resolved) ──────────────────── */
  function profBg(level) {
    return PROF_COLORS[Math.round(level)] || PROF_COLORS[0];
  }

  /* ── Offline detection ─────────────────────────────────────── */
  function setupOfflineDetection() {
    function update() {
      var banner = document.getElementById('m-offline-banner');
      if (banner) banner.style.display = navigator.onLine ? 'none' : '';
    }
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  }

  /* ── Public API ─────────────────────────────────────────────── */
  return {
    ICONS: ICONS,
    avatarColor: avatarColor,
    avatarInitials: avatarInitials,
    navBar: navBar,
    largeTitleHTML: largeTitleHTML,
    presentSheet: presentSheet,
    dismissSheet: dismissSheet,
    showToast: showToast,
    hideToast: hideToast,
    setupScrollTitle: setupScrollTitle,
    haptic: haptic,
    relativeTime: relativeTime,
    dateGroupLabel: dateGroupLabel,
    esc: _esc,
    profBg: profBg,
    setupOfflineDetection: setupOfflineDetection
  };
})();
