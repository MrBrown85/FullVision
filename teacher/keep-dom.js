// @ts-check
/* ── keep-dom.js — draw markup into a place without replacing its parts ──
   A page's toolbar is drawn from state each time something on the page
   changes. Setting innerHTML threw every control away: the search box lost
   its keyboard, the buttons flashed, the Show slider's lit pill could not
   glide. KeepDom.patch(root, html) reads the new markup and walks the old
   parts beside it, changing only what differs (attributes, text, a part
   added or removed). A part whose tag is unchanged stays the same element.

   What the markup does not hold is left alone: an input's typed text and
   focus while it has the keyboard, and the slider glide's own pill and its
   marks (seg-glide.js), which are put back by the glide itself.
   Handlers are delegated (data-action), so a kept element needs no rewiring. */
window.KeepDom = (function () {
  'use strict';

  /** The glide's pill sits inside a slider for 220 ms; it is not the page's.
   * @param {Node} n @returns {boolean} */
  function _glide(n) {
    return n.nodeType === 1 && /** @type {Element} */ (n).classList.contains('seg-glide');
  }

  /** @param {Element} old @param {Element} next */
  function _attrs(old, next) {
    var gliding = old.classList.contains('seg-gliding');
    Array.prototype.slice.call(old.attributes).forEach(function (/** @type {Attr} */ a) {
      if (next.hasAttribute(a.name)) return;
      if (gliding && a.name === 'style') return;
      old.removeAttribute(a.name);
    });
    Array.prototype.slice.call(next.attributes).forEach(function (/** @type {Attr} */ a) {
      if (old.getAttribute(a.name) === a.value) return;
      if (gliding && a.name === 'style') return;
      if (gliding && a.name === 'class') {
        old.setAttribute('class', a.value + ' seg-gliding');
        return;
      }
      old.setAttribute(a.name, a.value);
    });
  }

  /** @param {Element} old @param {Element} next */
  function _same(old, next) {
    return old.nodeType === next.nodeType && old.nodeName === next.nodeName;
  }

  /** @param {Node} old @param {Node} next */
  function _node(old, next) {
    if (old.nodeType === 3 || old.nodeType === 8) {
      if (old.nodeValue !== next.nodeValue) old.nodeValue = next.nodeValue;
      return;
    }
    var o = /** @type {Element} */ (old);
    var n = /** @type {Element} */ (next);
    _attrs(o, n);
    if (o.nodeName === 'INPUT' || o.nodeName === 'TEXTAREA') {
      var inp = /** @type {HTMLInputElement} */ (o);
      var want = o.nodeName === 'TEXTAREA' ? n.textContent || '' : n.getAttribute('value') || '';
      if (o !== document.activeElement && inp.value !== want) inp.value = want;
      return;
    }
    _children(o, n);
    if (o.nodeName === 'SELECT') {
      /** @type {HTMLSelectElement} */ (o).selectedIndex = /** @type {HTMLSelectElement} */ (n).selectedIndex;
    }
  }

  /** @param {Node} old @param {Node} next */
  function _children(old, next) {
    var have = Array.prototype.filter.call(old.childNodes, function (/** @type {Node} */ c) {
      return !_glide(c);
    });
    var want = Array.prototype.slice.call(next.childNodes);
    var i;
    for (i = 0; i < want.length; i++) {
      var o = have[i];
      var w = want[i];
      if (!o) {
        old.appendChild(document.importNode(w, true));
      } else if (_same(/** @type {Element} */ (o), /** @type {Element} */ (w))) {
        _node(o, w);
      } else {
        old.replaceChild(document.importNode(w, true), o);
      }
    }
    for (i = want.length; i < have.length; i++) old.removeChild(have[i]);
  }

  /** Draws `html` into `root`, keeping the parts that did not change.
   * @param {Element} root @param {string} html */
  function patch(root, html) {
    var tpl = document.createElement('template');
    // html-safe: the caller's markup, which escapes its own text; it is only read here, never attached
    tpl.innerHTML = html;
    _children(root, tpl.content);
  }

  return { patch: patch };
})();
