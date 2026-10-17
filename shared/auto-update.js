/*
 * Quiet updates for a tab left open for days.
 *
 * Every deploy changes sw.js (scripts/build.sh renames its cache), so the
 * browser installs a new service worker when it next checks, and that worker
 * takes over the page at once (skipWaiting + clients.claim). The page never
 * reloads its own code, though: moving between pages is all in one document.
 * This file checks for a new worker when the tab comes back into view and
 * every half hour, and once one has taken over, reloads the page at the next
 * safe moment. There is no banner and no prompt.
 *
 * A safe moment: the tab is hidden, or was shown again in the last few
 * seconds and the teacher hasn't clicked or typed since; nothing is waiting
 * in the outbox and no write has failed (a reload gives a failed write one
 * last try and then drops it); and nothing is being edited: no focused field,
 * no open dialog or sheet, no typed text that hasn't been saved, no unsaved
 * report narrative. Otherwise it waits and tries again.
 */

var AUTO_UPDATE_CHECK_EVERY_MS = 30 * 60 * 1000;
var AUTO_UPDATE_SHOWN_GRACE_MS = 10 * 1000;
var AUTO_UPDATE_RETRY_MS = 30 * 1000;

var _autoUpdate = {
  pending: false, // a new version has taken over this tab
  reloading: false,
  shownAt: 0, // when the tab last became visible
  inputAt: 0, // when the teacher last clicked, tapped or typed
  checkedAt: 0,
  retryTimer: null,
};

/* Writes not yet sent, or sent and refused. */
function _autoUpdateOutboxBusy() {
  if (typeof _hasUnsentWrites === 'function' && _hasUnsentWrites()) return true;
  var q = window.v2Queue;
  if (!q || typeof q.stats !== 'function') return false;
  try {
    var s = q.stats();
    return (s.queued || 0) > 0 || (s.deadLettered || 0) > 0 || !!s.flushing;
  } catch (e) {
    return true;
  }
}

function _autoUpdateIsField(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  var tag = String(el.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/* A text box whose contents differ from what the page drew: typed, not yet
   saved and drawn again. Search boxes don't count. */
function _autoUpdateIsDirtyField(el) {
  var tag = String(el.tagName || '').toUpperCase();
  var type = String(el.type || 'text').toLowerCase();
  if (tag === 'INPUT') {
    if (/^(hidden|button|submit|reset|checkbox|radio|file|range|color|search)$/.test(type)) return false;
    if (/search/i.test(String(el.className || ''))) return false;
  } else if (tag !== 'TEXTAREA') {
    return false;
  }
  return String(el.value == null ? '' : el.value) !== String(el.defaultValue == null ? '' : el.defaultValue);
}

/* The teacher is in the middle of something a reload would lose. */
function _autoUpdateEditing() {
  var doc = document;
  if (_autoUpdateIsField(doc.activeElement)) return true;
  if (doc.querySelector('[aria-modal="true"], .m-sheet.m-sheet-visible')) return true;
  var rq = window.ReportQuestionnaire;
  if (rq && rq.tqNarrativeDirty) return true;
  var fields = doc.querySelectorAll('input, textarea');
  for (var i = 0; i < fields.length; i++) {
    if (_autoUpdateIsDirtyField(fields[i])) return true;
  }
  return false;
}

function _autoUpdateSafeNow(now) {
  if (!_autoUpdate.pending || _autoUpdate.reloading) return false;
  if (document.visibilityState !== 'hidden') {
    var justShown = now - _autoUpdate.shownAt < AUTO_UPDATE_SHOWN_GRACE_MS;
    if (!justShown || _autoUpdate.inputAt >= _autoUpdate.shownAt) return false;
  }
  if (_autoUpdateOutboxBusy()) return false;
  return !_autoUpdateEditing();
}

function _autoUpdateReload() {
  _autoUpdate.reloading = true;
  location.reload();
}

function _autoUpdateTry() {
  if (!_autoUpdateSafeNow(Date.now())) return false;
  if (_autoUpdate.retryTimer) clearInterval(_autoUpdate.retryTimer);
  _autoUpdate.retryTimer = null;
  _autoUpdateReload();
  return true;
}

function _autoUpdateMarkPending() {
  _autoUpdate.pending = true;
  if (_autoUpdateTry() || _autoUpdate.retryTimer) return;
  // The outbox may empty while the tab sits hidden; look again now and then.
  _autoUpdate.retryTimer = setInterval(_autoUpdateTry, AUTO_UPDATE_RETRY_MS);
}

/* Ask the browser to fetch sw.js and install it if it changed. */
function _autoUpdateCheck() {
  var sw = navigator.serviceWorker;
  if (!sw || _autoUpdate.pending) return;
  _autoUpdate.checkedAt = Date.now();
  sw.getRegistration()
    .then(function (reg) {
      if (reg) return reg.update();
    })
    .catch(function () {});
}

function _autoUpdateInit() {
  var sw = typeof navigator !== 'undefined' && navigator.serviceWorker;
  if (!sw || typeof sw.addEventListener !== 'function') return;

  // A first visit has no worker yet; the one it installs then takes over the
  // page, which is not a new version.
  var hadController = !!sw.controller;
  sw.addEventListener('controllerchange', function () {
    if (hadController) _autoUpdateMarkPending();
    hadController = true;
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      _autoUpdate.shownAt = Date.now();
      if (Date.now() - _autoUpdate.checkedAt > 60 * 1000) _autoUpdateCheck();
    }
    if (_autoUpdate.pending) _autoUpdateTry();
  });

  var noteInput = function () {
    _autoUpdate.inputAt = Date.now();
  };
  if (typeof window.addEventListener === 'function') {
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (type) {
      window.addEventListener(type, noteInput, { capture: true, passive: true });
    });
  }

  setInterval(_autoUpdateCheck, AUTO_UPDATE_CHECK_EVERY_MS);
}

_autoUpdateInit();
