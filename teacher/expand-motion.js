// @ts-check
/* ── expand-motion.js — a card or folder opening and closing ──────────
   On the Assignments page a card or a folder opens and closes at once.
   The motion says where the content came from and went (Colin, Nov 13:
   "a zippy and subtle animation, that users would expect"): opening, the
   body grows to its height as its content fades in; closing, a little
   quicker, it folds back into its header. The rows under it glide.

   Nothing waits on it: the content is drawn before the motion starts, and
   a close's content is let go when it ends. With Reduce Motion on, in a
   browser with no Web Animations, or while the page is hidden, there is
   none and everything happens at once, as before.

   open(body): call once the body shows, with its content in.
   toggle(host, body, on, holdClass): a host whose body stays drawn while
   closed (a folder): its 'open' class set, with the motion.
   close(host, body, holdClass, done): call once the host no longer counts
   as open. `holdClass` on the host keeps the body showing while it
   closes; `done` runs when it has (at once with no motion), unless the
   host opened again first. */
/** @type {any} */ (window).ExpandMotion = (function () {
  'use strict';

  var OPEN_MS = 170;
  var CLOSE_MS = 130;
  var EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
  var EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';

  /** @param {any} el */
  function _canMove(el) {
    if (!el || typeof el.animate !== 'function') return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    var mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    return !(mq && mq.matches);
  }

  /* A motion the browser is not running (a page drawn but not shown, as
     in a hidden pane) is finished when its time is up, so the content is
     never left folded away. */
  /** @param {any} el @param {Animation} motion @param {number} ms */
  function _guard(el, motion, ms) {
    setTimeout(function () {
      if (el._expandMotion === motion && motion.playState !== 'finished') motion.finish();
    }, ms + 100);
  }

  /** The motion running on an element, stopped where it is. @param {any} el */
  function _stop(el) {
    var running = el && el._expandMotion;
    if (!running) return;
    el._expandMotion = null;
    running.onfinish = null;
    running.cancel();
  }

  /* The body's box: its content height and its top and bottom padding. A
     tall body moves only a window's height; the rest is below the screen. */
  /** @param {HTMLElement} body */
  function _box(body) {
    var cs = getComputedStyle(body);
    var pt = parseFloat(cs.paddingTop) || 0;
    var pb = parseFloat(cs.paddingBottom) || 0;
    var h = Math.max(0, body.clientHeight - pt - pb);
    return { h: Math.min(h, (window.innerHeight || 800) * 1.2), pt: pt, pb: pb };
  }

  /** @param {HTMLElement} body @param {boolean} opening */
  function _frames(body, opening) {
    var b = _box(body);
    var shut = { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 };
    var full = { height: b.h + 'px', paddingTop: b.pt + 'px', paddingBottom: b.pb + 'px', opacity: 1 };
    return opening ? [shut, full] : [full, shut];
  }

  /** @param {any} body */
  function open(body) {
    _stop(body);
    if (!_canMove(body) || !body.isConnected) return;
    body.style.overflow = 'hidden';
    var motion = body.animate(_frames(body, true), { duration: OPEN_MS, easing: EASE_OUT });
    body._expandMotion = motion;
    _guard(body, motion, OPEN_MS);
    motion.onfinish = function () {
      if (body._expandMotion !== motion) return;
      body._expandMotion = null;
      body.style.overflow = '';
    };
  }

  /** @param {any} host @param {any} body @param {string} holdClass @param {() => void} [done] */
  function close(host, body, holdClass, done) {
    _stop(body);
    if (!_canMove(body) || !body.isConnected) {
      if (done) done();
      return;
    }
    // The body shows while it folds away, though the host is closed already.
    host.classList.add(holdClass);
    body.style.overflow = 'hidden';
    var motion = body.animate(_frames(body, false), { duration: CLOSE_MS, easing: EASE_IN });
    body._expandMotion = motion;
    _guard(body, motion, CLOSE_MS);
    motion.onfinish = function () {
      if (body._expandMotion !== motion) return;
      body._expandMotion = null;
      body.style.overflow = '';
      host.classList.remove(holdClass);
      if (done) done();
    };
  }

  /* An open or close in flight is dropped: the host is being drawn again,
     or opened again before it finished closing. */
  /** @param {any} host @param {any} body @param {string} holdClass */
  function settle(host, body, holdClass) {
    _stop(body);
    if (body && body.style) body.style.overflow = '';
    if (host && host.classList) host.classList.remove(holdClass);
  }

  /* A host whose body stays drawn while closed (a folder): its 'open'
     class set, with the motion. */
  /** @param {any} host @param {any} body @param {boolean} on @param {string} holdClass */
  function toggle(host, body, on, holdClass) {
    if (body) settle(host, body, holdClass);
    host.classList.toggle('open', on);
    if (!body) return;
    if (on) open(body);
    else close(host, body, holdClass);
  }

  return { open: open, close: close, settle: settle, toggle: toggle };
})();
