/* m-components.js — Shared iOS-style mobile UI components */

window.MComponents = (function () {
  'use strict';

  /* ── SVG Icons (SF Symbols style) ──────────────────────────── */
  var ICONS = {
    chevronLeft:
      '<svg width="13" height="20" viewBox="0 0 13 20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2L3 10l8 8"/></svg>',
    chevronRight:
      '<svg class="m-cell-chevron" width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l5.5 5.5L1 12"/></svg>',
    plus: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    settings:
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
    sort: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="9" y2="18"/></svg>',
  };

  /* ── Avatar helper ─────────────────────────────────────────── */
  function avatarColor(id) {
    var hash = 0;
    for (var i = 0; i < id.length; i++) hash = (hash << 5) - hash + id.charCodeAt(i);
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
      back =
        '<button class="m-nav-bar-back" data-action="m-back">' +
        ICONS.chevronLeft +
        '<span>' +
        _esc(opts.backLabel) +
        '</span></button>';
    }
    // `classId`: a tab's first screen names the open class at the left.
    if (!back && opts.classId) back = classLabelHTML(opts.classId);
    var actions = '';
    if (opts.rightHTML) {
      actions = '<div class="m-nav-bar-actions">' + opts.rightHTML + '</div>';
    }
    var subtitle = opts.subtitle
      ? '<div style="font-size:12px;color:var(--text-3);font-weight:400">' + _esc(opts.subtitle) + '</div>'
      : '';
    // `compact`: the title shows in the bar at rest (no large title below).
    return (
      '<div class="m-nav-bar' +
      (opts.compact ? ' m-nav-bar-compact' : '') +
      '" id="m-nav-bar-' +
      (opts.id || 'main') +
      '">' +
      '<div class="m-nav-bar-inner">' +
      back +
      '<h1 class="m-nav-bar-title-inline">' +
      _esc(opts.title) +
      subtitle +
      '</h1>' +
      actions +
      '</div></div>'
    );
  }

  // The open class's name, so a teacher always knows which class they are in.
  function classLabelHTML(cid) {
    var course = (typeof COURSES !== 'undefined' && cid && COURSES[cid]) || null;
    var name = course && course.name ? course.name : '';
    if (!name) return '';
    return (
      '<div class="m-nav-bar-class" title="' +
      _esc(name) +
      '">' +
      '<span class="m-nav-bar-class-name">' +
      _esc(name) +
      '</span></div>'
    );
  }

  function largeTitleHTML(title) {
    return '<div class="m-title-large" aria-hidden="true">' + _esc(title) + '</div>';
  }

  /* ── Sheet (present / dismiss) ─────────────────────────────── */
  var _sheetCloseCallback = null;

  function presentSheet(html, opts) {
    opts = opts || {};
    var backdrop = document.getElementById('m-sheet-backdrop');
    var container = document.getElementById('m-sheet-container');
    var halfClass = opts.half ? ' m-sheet-half' : '';
    // html-safe: every presentSheet caller (tab-observe, tab-grade, tab-students, card-widget-editor, card-widgets commentSheetHtml, shell settings) builds html with MC.esc on its text.
    container.innerHTML =
      '<div class="m-sheet' +
      halfClass +
      '">' +
      '<div class="m-sheet-handle" role="button" tabindex="0" aria-label="Dismiss sheet"></div>' +
      '<div class="m-sheet-content">' +
      html +
      '</div></div>';
    backdrop.classList.remove('u-hidden');
    _sheetCloseCallback = opts.onClose || null;
    requestAnimationFrame(function () {
      backdrop.classList.add('m-sheet-visible');
      container.querySelector('.m-sheet').classList.add('m-sheet-visible');
    });
    backdrop.onclick = dismissSheet;
    var handle = container.querySelector('.m-sheet-handle');
    if (handle) {
      handle.onclick = dismissSheet;
      handle.onkeydown = function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          dismissSheet();
        }
      };
    }
    _bindSheetSwipe(container.querySelector('.m-sheet'));
  }

  function _bindSheetSwipe(sheet) {
    if (!sheet) return;
    var startY = 0,
      dy = 0,
      dragging = false,
      startT = 0;
    var DISMISS_THRESHOLD = 80;
    var FLICK = 0.5; // px/ms
    var backdrop = document.getElementById('m-sheet-backdrop');

    sheet.addEventListener(
      'touchstart',
      function (e) {
        // Only allow swipe from handle area or when content is scrolled to top
        var content = sheet.querySelector('.m-sheet-content');
        var isHandle = e.target.closest('.m-sheet-handle');
        if (!isHandle && content && content.scrollTop > 0) return;
        startY = e.touches[0].clientY;
        startT = Date.now();
        dy = 0;
        dragging = false;
      },
      { passive: true },
    );

    sheet.addEventListener(
      'touchmove',
      function (e) {
        if (startY === 0) return;
        dy = e.touches[0].clientY - startY;
        if (!dragging && dy > 10) {
          dragging = true;
          sheet.style.transition = 'none';
          if (backdrop) backdrop.style.transition = 'none';
        }
        if (!dragging) return;
        e.preventDefault();
        if (dy > 0) {
          sheet.style.transform = 'translateY(' + dy + 'px)';
          if (backdrop) backdrop.style.opacity = String(Math.max(0, 1 - dy / sheet.offsetHeight));
        } else {
          // Pulling up gives a little, then holds.
          sheet.style.transform = 'translateY(' + dy * 0.15 + 'px)';
        }
      },
      { passive: false },
    );

    sheet.addEventListener(
      'touchend',
      function () {
        if (!dragging) {
          startY = 0;
          return;
        }
        sheet.style.transition = '';
        if (backdrop) {
          backdrop.style.transition = '';
          backdrop.style.opacity = '';
        }
        var velocity = dy / Math.max(Date.now() - startT, 1);
        if (dy > DISMISS_THRESHOLD || (dy > 20 && velocity > FLICK)) {
          sheet.style.transform = '';
          dismissSheet();
        } else {
          sheet.style.transform = 'translateY(0)';
        }
        startY = 0;
        dy = 0;
        dragging = false;
      },
      { passive: true },
    );
  }

  function dismissSheet() {
    var backdrop = document.getElementById('m-sheet-backdrop');
    var container = document.getElementById('m-sheet-container');
    var sheet = container.querySelector('.m-sheet');
    if (sheet) sheet.classList.remove('m-sheet-visible');
    backdrop.classList.remove('m-sheet-visible');
    setTimeout(function () {
      backdrop.classList.add('u-hidden');
      container.innerHTML = '';
      if (_sheetCloseCallback) {
        _sheetCloseCallback();
        _sheetCloseCallback = null;
      }
    }, 350);
  }

  /* ── Confirm sheet ─────────────────────────────────────────────
     A question in a sheet, as Back to Group Grade asks: a title, one line
     that says what will happen, the action and Cancel. It is a dialog to a
     screen reader, the focus starts on Cancel and Tab stays inside. Escape,
     the handle and a tap outside cancel (shell.js and presentSheet), and
     Cancel gives the focus back to `from`, the control that asked. `onOk`
     runs when the action is pressed. (S1-F3) */
  // html-safe: title, message and okLabel go through _esc.
  function confirmSheet(title, message, okLabel, onOk, from) {
    var done = false;
    presentSheet(
      '<div class="m-group-sheet m-confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="m-confirm-title" aria-describedby="m-confirm-text">' +
        '<div class="m-group-sheet-title is-question" id="m-confirm-title">' +
        _esc(title) +
        '</div>' +
        '<p class="m-group-sheet-text" id="m-confirm-text">' +
        _esc(message) +
        '</p>' +
        '<button type="button" class="m-group-sheet-btn m-confirm-ok">' +
        _esc(okLabel) +
        '</button>' +
        '<button type="button" class="m-group-sheet-btn m-group-sheet-cancel" data-action="m-sheet-cancel">Cancel</button>' +
        '</div>',
      {
        half: true,
        onClose: function () {
          if (!done && from && from.isConnected && typeof from.focus === 'function')
            from.focus({ preventScroll: true });
        },
      },
    );
    var box = document.querySelector('#m-sheet-container .m-confirm-sheet');
    if (!box) return;
    var ok = box.querySelector('.m-confirm-ok');
    var cancel = box.querySelector('.m-group-sheet-cancel');
    ok.onclick = function () {
      if (done) return;
      done = true;
      dismissSheet();
      onOk();
    };
    // Tab and Shift+Tab go between the two buttons and nowhere else.
    box.onkeydown = function (e) {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      (document.activeElement === cancel ? ok : cancel).focus();
    };
    cancel.focus({ preventScroll: true });
  }

  /* ── Toast ──────────────────────────────────────────────────── */
  var _toastTimer = null;

  function showToast(message, opts) {
    opts = opts || {};
    var el = document.getElementById('m-toast');
    var undoBtn = opts.onUndo ? '<button class="m-toast-undo" data-action="m-toast-undo">Undo</button>' : '';
    clearTimeout(_toastOutTimer);
    el.innerHTML = '<div class="m-toast-item"><span>' + _esc(message) + '</span>' + undoBtn + '</div>';
    _placeToast(el);
    if (opts.onUndo) {
      el.querySelector('[data-action="m-toast-undo"]').onclick = function () {
        opts.onUndo();
        hideToast();
      };
    }
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(hideToast, opts.duration || 5000);
  }

  /* On a screen with the + button the toast sits 12 px above the button and
     over it, so Undo is never under it. Elsewhere it stays above the tab bar. */
  function _placeToast(el) {
    var fab = Array.prototype.find.call(document.querySelectorAll('.m-fab'), function (f) {
      return f.getBoundingClientRect().width > 0 && getComputedStyle(f).visibility !== 'hidden';
    });
    el.classList.toggle('m-toast-over-fab', !!fab);
    el.style.bottom = fab ? window.innerHeight - fab.getBoundingClientRect().top + 12 + 'px' : '';
  }

  var _toastOutTimer = null;
  function hideToast() {
    clearTimeout(_toastTimer);
    var el = document.getElementById('m-toast');
    var item = el.querySelector('.m-toast-item');
    if (!item) return;
    item.classList.add('m-toast-out');
    clearTimeout(_toastOutTimer);
    _toastOutTimer = setTimeout(function () {
      if (item.parentNode) item.parentNode.removeChild(item);
    }, 200);
  }

  /* ── Scroll → large title collapse ─────────────────────────── */
  function setupScrollTitle(screenEl, navBarId) {
    var content = screenEl.querySelector('.m-screen-content');
    var navBar = document.getElementById(navBarId);
    if (!content || !navBar) return;
    content.addEventListener(
      'scroll',
      function () {
        if (content.scrollTop > 10) {
          navBar.classList.add('m-nav-bar-scrolled');
        } else {
          navBar.classList.remove('m-nav-bar-scrolled');
        }
      },
      { passive: true },
    );
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
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var d;
    // Parse YYYY-MM-DD as a local calendar date. new Date('YYYY-MM-DD')
    // is interpreted as UTC and shifts backward in western time zones.
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) {
      var parts = dateStr.split('-');
      d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    } else {
      d = new Date(dateStr);
    }
    d.setHours(0, 0, 0, 0);
    var diff = Math.round((today - d) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return 'This week';
    return 'Earlier';
  }

  /* ── HTML escape ───────────────────────────────────────────── */
  /* shared/html.js's esc, under the name the phone code has always used. */
  function _esc(str) {
    return esc(str);
  }

  /* ── Proficiency color (CSS var resolved) ──────────────────── */
  function profBg(level) {
    return PROF_COLORS[roundLevel(level)] || PROF_COLORS[0];
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
  /* How many of a student's assessments in the class's chosen term have a
     score (points, a level or Complete/Incomplete): the student screen's
     "N Scored" and the card's growth line read this one count. */
  function scoredAssessmentCount(cid, sid) {
    return getAssessments(cid).filter(function (a) {
      if (typeof assessmentInYearToDate === 'function' && !assessmentInYearToDate(cid, a)) return false;
      var kind = assessmentCellValue(cid, sid, a).kind;
      return kind === 'points' || kind === 'level' || kind === 'complete';
    }).length;
  }

  /* ── The level buttons and Fine-tune (the board "Phone Speed Grader With
     Photos") ──────────────────────────────────────────────────────────
     A criterion's or competency's four levels, each its figure over its
     word (1 Emerging … 4 Extending; in a Letter class too), in the class's
     level order; the chosen one carries its + or − ("2+"). Under them,
     Fine-tune <level>: − Minus and + Plus, greyed out with no level. Every
     level row of the phone grader is drawn here, the classic grader's and
     the grader with photos', so they look the same. A level's word is
     scoreLevelText's and its figure formatScoreLevel's (shared/constants.js).
     opts: order (levelOrderFor), level (whole, 0 for none), mod, mixed
     (competencies that disagree: the lowest, outlined, no + or −), action,
     attrs (the data attributes every button carries; ids are ours). */
  // html-safe: levels are numbers, words constants, attrs ours
  function levelButtonsHTML(opts) {
    var mod = opts.mixed ? 0 : opts.mod;
    return opts.order
      .map(function (lv) {
        var on = opts.level === lv;
        var fig = on ? formatScoreLevel(lv, mod) : String(lv);
        return (
          '<button class="m-score-btn m-level-btn' +
          (on ? ' m-score-active' : '') +
          (on && opts.mixed ? ' m-score-mixed' : '') +
          '" data-action="' +
          opts.action +
          '" data-score="' +
          lv +
          '"' +
          opts.attrs +
          ' aria-label="' +
          fig +
          ', ' +
          scoreLevelText(lv) +
          '"><span class="m-level-fig">' +
          fig +
          '</span><span class="m-level-word">' +
          scoreLevelText(lv) +
          '</span></button>'
        );
      })
      .join('');
  }

  // A row's buttons after a save, without drawing the row again.
  function paintLevelButtons(btns, level, mod) {
    btns.forEach(function (btn) {
      var lv = parseInt(btn.getAttribute('data-score'), 10);
      var on = level === lv;
      var fig = on ? formatScoreLevel(lv, mod) : String(lv);
      btn.classList.toggle('m-score-active', on);
      btn.classList.remove('m-score-mixed');
      btn.setAttribute('aria-label', fig + ', ' + scoreLevelText(lv));
      var f = btn.querySelector('.m-level-fig');
      if (f) f.textContent = fig;
    });
  }

  // "Fine-tune Proficient"; with no level, "Fine-tune <the row's name>".
  function fineTuneLabel(level, name) {
    return 'Fine-tune ' + (scoreLevelText(level) || name || 'level');
  }

  // − Minus and + Plus. 1− and 4+ don't exist, so those are greyed out too.
  // html-safe: fixed markup; m is -1 or 1 and scoreModSuffix returns '+' or '−'.
  function fineTuneButtonsHTML(level, mod) {
    return [-1, 1]
      .map(function (m) {
        var allowed = level > 0 && normalizeScoreMod(level, m) === m;
        var on = allowed && mod === m;
        return (
          '<button class="m-mod-btn' +
          (on ? ' m-mod-active' : '') +
          '" data-action="m-grade-mod" data-mod="' +
          m +
          '" aria-pressed="' +
          on +
          '"' +
          (allowed ? '' : ' disabled') +
          '><span class="m-mod-sign" aria-hidden="true">' +
          scoreModSuffix(m) +
          '</span>' +
          (m > 0 ? 'Plus' : 'Minus') +
          '</button>'
        );
      })
      .join('');
  }

  return {
    levelButtonsHTML: levelButtonsHTML,
    paintLevelButtons: paintLevelButtons,
    fineTuneLabel: fineTuneLabel,
    fineTuneButtonsHTML: fineTuneButtonsHTML,
    scoredAssessmentCount: scoredAssessmentCount,
    ICONS: ICONS,
    avatarColor: avatarColor,
    avatarInitials: avatarInitials,
    navBar: navBar,
    largeTitleHTML: largeTitleHTML,
    presentSheet: presentSheet,
    dismissSheet: dismissSheet,
    confirmSheet: confirmSheet,
    showToast: showToast,
    hideToast: hideToast,
    setupScrollTitle: setupScrollTitle,
    haptic: haptic,
    relativeTime: relativeTime,
    dateGroupLabel: dateGroupLabel,
    esc: _esc,
    profBg: profBg,
    setupOfflineDetection: setupOfflineDetection,
  };
})();
