// @ts-check
/* pull-refresh.js — the phone app's pull to refresh, moved out of shell.js
   as it was. On a list at its top, a pull brings the content down with the
   finger (with resistance) and grows the spinner; past the threshold a
   release reloads the class while the content waits, then it springs back.
   Not on the card stack, which has its own gestures. shell.js starts it
   with the reload to run (init). */
/** @type {any} */ (window).MPullRefresh = (function () {
  'use strict';

  var PULL_THRESHOLD = 70;
  var PULL_HOLD = 48;
  /** @type {{ content: HTMLElement, startX: number, startY: number, decided: boolean, on: boolean, dy: number } | null} */
  var _pull = null;
  /** @type {HTMLElement | null} */
  var _pullIndicator = null;
  var _refreshing = false;
  var _pullToRefreshInitialized = false;
  /** @type {() => Promise<void>} */
  var _reload = function () {
    return Promise.resolve();
  };
  /** @param {() => Promise<void>} reload */
  function init(reload) {
    if (_pullToRefreshInitialized) return;
    _pullToRefreshInitialized = true;
    _reload = reload;
    document.addEventListener(
      'touchstart',
      function (/** @type {TouchEvent} */ e) {
        _pull = null;
        _pullOff();
        if (_refreshing) return;
        var at = /** @type {Element} */ (e.target);
        var content = /** @type {HTMLElement | null} */ (at.closest('.m-screen-content'));
        if (!content || content.scrollTop > 0) return;
        if (at.closest('.m-card-stack')) return;
        var backdrop = document.getElementById('m-sheet-backdrop');
        if (backdrop && !backdrop.classList.contains('u-hidden')) return;
        _pull = {
          content: content,
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
          decided: false,
          on: false,
          dy: 0,
        };
        // Only an armed pull listens to the moves (and can stop the scroll), so no other touch waits for this script.
        document.addEventListener('touchmove', _pullMove, { passive: false });
      },
      { passive: true },
    );
    document.addEventListener('touchend', _pullEnd, { passive: true });
    document.addEventListener('touchcancel', _pullOff, { passive: true });
  }

  function _pullOff() {
    document.removeEventListener('touchmove', _pullMove);
  }

  /** @param {TouchEvent} e */
  function _pullMove(e) {
    if (!_pull) return;
    var dx = e.touches[0].clientX - _pull.startX;
    var dy = e.touches[0].clientY - _pull.startY;
    if (!_pull.decided) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      _pull.decided = true;
      if (dy <= 0 || Math.abs(dx) > dy || _pull.content.scrollTop > 0) {
        _pull = null;
        return _pullOff();
      }
      _pull.on = true;
      _pull.content.classList.add('m-pulling');
      _showPullIndicator();
    }
    if (!_pull.on) return;
    e.preventDefault();
    // Resistance: the content moves less and less as the pull grows.
    var pull = Math.min(120, Math.max(0, dy) * 0.5);
    _pull.dy = pull;
    _pull.content.style.transform = 'translateY(' + pull + 'px)';
    if (!_pullIndicator) return;
    _pullIndicator.style.height = pull + 'px';
    _pullIndicator.classList.toggle('m-pull-ready', pull >= PULL_THRESHOLD);
    _pullIndicator.style.setProperty('--m-pull', String(Math.min(1, pull / PULL_THRESHOLD)));
  }

  function _pullEnd() {
    _pullOff();
    if (!_pull || !_pull.on) {
      _pull = null;
      return;
    }
    var p = _pull;
    _pull = null;
    p.content.classList.remove('m-pulling');
    if (p.dy >= PULL_THRESHOLD) {
      _settlePull(p.content, PULL_HOLD);
      _refreshing = true;
      _reload().then(function () {
        _refreshing = false;
        _settlePull(p.content, 0);
      });
    } else {
      _settlePull(p.content, 0);
    }
  }

  function _showPullIndicator() {
    var ind = _pullIndicator;
    if (!ind) {
      ind = _pullIndicator = document.createElement('div');
      ind.className = 'm-pull-indicator';
      ind.innerHTML = '<span class="m-pull-spinner"></span>';
      var app = document.getElementById('m-app');
      if (app) app.prepend(ind);
    }
    ind.classList.remove('m-pull-settle');
  }

  // The content and the spinner ease to `px` down (0 = back in place).
  /** @param {HTMLElement} content @param {number} px */
  function _settlePull(content, px) {
    content.classList.add('m-pull-settle');
    content.style.transform = px ? 'translateY(' + px + 'px)' : '';
    if (_pullIndicator) {
      _pullIndicator.classList.add('m-pull-settle');
      _pullIndicator.style.height = px + 'px';
      _pullIndicator.classList.toggle('m-pull-ready', px > 0);
      _pullIndicator.style.setProperty('--m-pull', px ? '1' : '0');
    }
    setTimeout(function () {
      content.classList.remove('m-pull-settle');
    }, 300);
  }

  return { init: init };
})();
