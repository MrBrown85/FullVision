// @ts-check
/* seg-glide.js — every slider's lit pill glides to its new place.

   A slider is a row of buttons with one lit: the desktop's .seg-btn (the top
   tabs among them), the phone's .m-seg-btn, the Work Wall's .ww-seg-btn, the
   student preview's .ps-seg-btn and Add Work's .awc-seg-btn. When the lit
   button changes, a copy of its pill slides from the old place to the new
   one in 220 ms, the way the top tabs do (router.js), then the real pill is
   back. Nothing waits on it: the change itself has already happened.

   run(track, from, to) is the glide itself; segSelect (teacher/ui.js) and the
   router call it. Most sliders draw their whole bar again on a click, so a
   watcher here notes the lit pill on each click or key in a slider and, on
   the next frames before they are painted, finds the bar again (the same
   one, or the one drawn in its place) and glides it if the lit one moved.
   No glide with reduced motion, in print, or when one is already running. */
window.SegGlide = (function () {
  'use strict';

  var MS = 220;
  var BTN = '.seg-btn, .m-seg-btn, .ww-seg-btn, .ps-seg-btn, .awc-seg-btn';
  var LIT =
    '.active, .is-on, .m-seg-active, .tb-seg-active, [aria-selected="true"], [aria-checked="true"], [aria-pressed="true"], [aria-current="page"]';

  /** @returns {boolean} */
  function motionOK() {
    if (!window.matchMedia) return false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    return !window.matchMedia('print').matches;
  }

  /** A slider's buttons: the direct children that are slider buttons.
   * @param {Element} track @returns {HTMLElement[]} */
  function _buttons(track) {
    return Array.prototype.filter.call(track.children, function (/** @type {Element} */ c) {
      return c.matches(BTN);
    });
  }

  /** The lit button of a slider, or null. @param {Element} track @returns {HTMLElement | null} */
  function lit(track) {
    var on = _buttons(track).filter(function (b) {
      return b.matches(LIT);
    });
    return on.length === 1 ? on[0] : null;
  }

  /** The slider a button sits in, or null. @param {any} el @returns {HTMLElement | null} */
  function trackOf(el) {
    var btn = el && el.closest ? el.closest(BTN) : null;
    var track = btn && btn.parentElement;
    return track && _buttons(track).length > 1 ? track : null;
  }

  /** Puts the real pills back without letting a fade run on them.
   * @param {HTMLElement} track */
  function _settle(track) {
    var btns = _buttons(track);
    btns.forEach(function (b) {
      b.style.transition = 'none';
    });
    track.classList.remove('seg-gliding');
    void track.offsetWidth;
    btns.forEach(function (b) {
      b.style.transition = '';
    });
  }

  /** The lit pill slides from `from` to `to` (rects in the window).
   * @param {HTMLElement} track @param {{ left: number, width: number }} from
   * @param {DOMRect} to @param {number} [ms] */
  function run(track, from, to, ms) {
    if (!track.animate || !from.width || !to.width || !motionOK()) return;
    var on = lit(track);
    if (!on) return;
    var t = /** @type {any} */ (track);
    if (t._fvGlide) t._fvGlide.remove();
    var cs = getComputedStyle(on);
    var box = track.getBoundingClientRect();
    var glide = document.createElement('span');
    glide.className = 'seg-glide';
    glide.setAttribute('aria-hidden', 'true');
    glide.style.cssText =
      'top:' +
      (to.top - box.top - track.clientTop + track.scrollTop) +
      'px;height:' +
      to.height +
      'px;left:0;width:' +
      to.width +
      'px;background:' +
      cs.backgroundColor +
      ';border-radius:' +
      cs.borderRadius +
      ';box-shadow:' +
      cs.boxShadow +
      ';';
    var placed = getComputedStyle(track).position === 'static';
    if (placed) track.style.position = 'relative';
    t._fvGlide = glide;
    track.classList.add('seg-gliding');
    track.appendChild(glide);
    var fromX = from.left - box.left - track.clientLeft + track.scrollLeft;
    var toX = to.left - box.left - track.clientLeft + track.scrollLeft;
    var done = function () {
      glide.remove();
      if (t._fvGlide !== glide) return;
      t._fvGlide = null;
      if (placed) track.style.position = '';
      _settle(track);
    };
    var anim = glide.animate(
      [
        { transform: 'translateX(' + fromX + 'px) scaleX(' + from.width / to.width + ')' },
        { transform: 'translateX(' + toX + 'px) scaleX(1)' },
      ],
      { duration: ms || MS, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'forwards' },
    );
    anim.onfinish = done;
    anim.oncancel = done;
    // The safety timer counts from the glide's start: on a slow computer a
    // page's draw can hold the start back longer than the glide lasts.
    anim.ready.then(function () {
      setTimeout(done, (ms || MS) + 250);
    }, done);
  }

  /* ── The watcher ───────────────────────────────────────── */
  /** What a click or key in a slider found, until the lit pill is seen again.
   * @type {{ track: HTMLElement, names: string, at: DOMRect, from: DOMRect, btn: string, tries: number } | null} */
  var _was = null;

  /** @param {Element} track */
  function _names(track) {
    return _buttons(track)
      .map(function (b) {
        return (b.getAttribute('data-val') || b.getAttribute('data-href') || b.textContent || '').trim();
      })
      .join('|');
  }

  /** The slider to look at now: the same one, or the one drawn in its place
   * (the same buttons; the nearest to where it was when there are more).
   * @param {NonNullable<typeof _was>} w @returns {HTMLElement | null} */
  function _find(w) {
    if (w.track.isConnected) return w.track;
    /** @type {HTMLElement[]} */
    var same = [];
    document.querySelectorAll(w.btn).forEach(function (b) {
      var track = b.parentElement;
      if (track && same.indexOf(track) < 0 && lit(track) === b && _names(track) === w.names) same.push(track);
    });
    if (same.length < 2) return same[0] || null;
    var gap = function (/** @type {HTMLElement} */ t) {
      var r = t.getBoundingClientRect();
      return Math.abs(r.left - w.at.left) + Math.abs(r.top - w.at.top);
    };
    same.sort(function (a, b) {
      return gap(a) - gap(b);
    });
    return same[0];
  }

  function _check() {
    var w = _was;
    if (!w) return;
    var track = _find(w);
    var on = track && lit(track);
    var t = /** @type {any} */ (track);
    if (track && t._fvGlide) {
      _was = null;
      return;
    }
    if (on && track) {
      var to = on.getBoundingClientRect();
      var box = track.getBoundingClientRect();
      // Measured from the bar, so a bar drawn a little to one side still glides true.
      var moved = Math.abs(to.left - box.left - (w.from.left - w.at.left)) > 1 || Math.abs(to.width - w.from.width) > 1;
      if (moved) {
        _was = null;
        run(track, { left: box.left + (w.from.left - w.at.left), width: w.from.width }, to);
        return;
      }
    }
    if (--w.tries <= 0) _was = null;
  }

  /** @param {Event} e */
  function _note(e) {
    if (!motionOK()) return;
    if (e.type === 'keydown') {
      var k = /** @type {KeyboardEvent} */ (e).key;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' '].indexOf(k) < 0) return;
    }
    var track = trackOf(e.target);
    var on = track && lit(track);
    if (!track || !on || /** @type {any} */ (track)._fvGlide) return;
    var btn = on.className.split(/\s+/).filter(function (c) {
      return /seg-btn$/.test(c);
    })[0];
    _was = {
      track: track,
      names: _names(track),
      at: track.getBoundingClientRect(),
      from: on.getBoundingClientRect(),
      btn: '.' + (btn || 'seg-btn'),
      tries: 4,
    };
    _watch();
  }

  // Looked at on the next frames, before they are painted: after the event's
  // own work, and a bar drawn a frame or two later.
  function _watch() {
    var w = _was;
    var frame = function () {
      if (_was !== w) return;
      _check();
      if (_was === w) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('click', _note, true);
    document.addEventListener('keydown', _note, true);
  }

  return { run: run, lit: lit, trackOf: trackOf, motionOK: motionOK, MS: MS };
})();
