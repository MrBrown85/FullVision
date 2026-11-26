// @ts-check
/* ── keep-dom.js — draw markup into a place without replacing its parts ──
   A page's parts are drawn from state each time something changes. Setting
   innerHTML threw every part away: the search box lost its keyboard, menus
   closed, the scroll went back to the top, the page flashed and a slider's
   lit pill could not glide (Colin, Nov 26, 2026). KeepDom.patch(root, html)
   reads the new markup and walks the old parts beside it, changing only what
   differs (attributes, text, a part added, moved or removed). A part whose
   tag and key are unchanged stays the same element. Handlers are delegated
   (data-action), so a kept element needs no rewiring.

   The one helper for this: the Assignments toolbar, the student list
   (sidebar-keep.js) and Class Settings (cm-keep-draw.js) all draw through it.

   What the markup does not hold is left alone: the slider glide's own pill
   and its marks (seg-glide.js), and a box the teacher is typing in.

   Options, all optional:
     fresh(old)   true for an old element to be replaced whole, not changed
                  (Class Settings' tab body when the tab changes)
     key(node)    what matches a new part to an old one wherever it sits;
                  the element's id by default (the list keys rows by student)
     own(node)    true for a part the page added after the draw (a note under
                  a name): it stays where it is, untouched
     shallow(el)  true for an element whose insides the page fills itself
                  (the grade chips): its attributes change, its children not
     keepClasses  classes the page sets after the draw that stay on
     keepTyped    an input's value is never set from the markup (the list's
                  search box holds what was typed even without the keyboard)
     began(box)   the value a box's typing began from (cm-keep-menu.js): a
                  focused box keeps its typing unless the page now holds a
                  different value. Without it a focused box always keeps it. */
window.KeepDom = (function () {
  'use strict';

  /**
   * @typedef {{
   *   fresh?: (old: Element) => boolean,
   *   key?: (node: Node) => string,
   *   own?: (node: Node) => boolean,
   *   shallow?: (el: Element) => boolean,
   *   keepClasses?: string[],
   *   keepTyped?: boolean,
   *   began?: (box: Element) => string,
   * }} KeepOptions
   */

  /** @param {Node} n @returns {string} */
  function _id(n) {
    return n.nodeType === 1 ? /** @type {Element} */ (n).id : '';
  }

  /** The glide's pill sits inside a slider for 220 ms; it is not the page's.
   * @param {Node} n @returns {boolean} */
  function _glide(n) {
    return n.nodeType === 1 && /** @type {Element} */ (n).classList.contains('seg-glide');
  }

  /** @param {Node} n @param {KeepOptions} o @returns {boolean} */
  function _passed(n, o) {
    return _glide(n) || (!!o.own && o.own(n));
  }

  /** The next old part to match from n on, past the glide's and the page's own.
   * @param {Node | null} n @param {KeepOptions} o @returns {Node | null} */
  function _from(n, o) {
    while (n && _passed(n, o)) n = n.nextSibling;
    return n;
  }

  /** @param {Node} a @param {Node} b @param {(n: Node) => string} key */
  function _same(a, b, key) {
    if (a.nodeType !== b.nodeType) return false;
    if (a.nodeType !== 1) return true;
    return a.nodeName === b.nodeName && key(a) === key(b);
  }

  /** @param {Element} old @param {Element} next @param {KeepOptions} o */
  function _attrs(old, next, o) {
    var gliding = old.classList.contains('seg-gliding');
    var kept = (o.keepClasses || []).filter(function (c) {
      return old.classList.contains(c);
    });
    var i;
    for (i = old.attributes.length - 1; i >= 0; i--) {
      var name = old.attributes[i].name;
      if (next.hasAttribute(name) || (gliding && name === 'style')) continue;
      old.removeAttribute(name);
    }
    for (i = 0; i < next.attributes.length; i++) {
      var a = next.attributes[i];
      if (gliding && a.name === 'style') continue;
      if (old.getAttribute(a.name) !== a.value) old.setAttribute(a.name, a.value);
    }
    if (gliding) kept.push('seg-gliding');
    kept.forEach(function (c) {
      old.classList.add(c);
    });
  }

  /** Whether a box keeps what the teacher typed rather than the markup's value.
   * @param {HTMLInputElement | HTMLTextAreaElement} box @param {string} want @param {KeepOptions} o */
  function _typing(box, want, o) {
    if (box !== document.activeElement) return false;
    return o.began ? o.began(box) === want : true;
  }

  /** The typed value, the tick and the choice, which the attributes stop
   * carrying once the teacher has touched a control.
   * @param {Element} old @param {Element} next @param {KeepOptions} o */
  function _controls(old, next, o) {
    if (old.nodeName === 'INPUT') {
      var inp = /** @type {HTMLInputElement} */ (old);
      if (inp.type === 'checkbox' || inp.type === 'radio') {
        var on = next.hasAttribute('checked');
        if (inp.checked !== on) inp.checked = on;
        return;
      }
      var want = next.getAttribute('value') || '';
      if (!o.keepTyped && inp.value !== want && !_typing(inp, want, o)) inp.value = want;
    } else if (old.nodeName === 'TEXTAREA') {
      var ta = /** @type {HTMLTextAreaElement} */ (old);
      var text = next.textContent || '';
      if (ta.value !== text && !_typing(ta, text, o)) ta.value = text;
      ta.defaultValue = text;
    } else if (old.nodeName === 'SELECT') {
      var pick = /** @type {HTMLSelectElement} */ (next).selectedIndex;
      if (/** @type {HTMLSelectElement} */ (old).selectedIndex !== pick)
        /** @type {HTMLSelectElement} */ (old).selectedIndex = pick;
    }
  }

  /** @param {Element} old @param {Element} next @param {KeepOptions} o */
  function _element(old, next, o) {
    _attrs(old, next, o);
    if (old.nodeName !== 'TEXTAREA' && !(o.shallow && o.shallow(old))) _children(old, next, o);
    _controls(old, next, o);
  }

  /** @param {Node} old @param {Node} next @param {KeepOptions} o */
  function _children(old, next, o) {
    var key = o.key || _id;
    /** @type {Record<string, Node>} */
    var byKey = {};
    Array.prototype.forEach.call(old.childNodes, function (/** @type {Node} */ c) {
      var k = !_passed(c, o) && c.nodeType === 1 ? key(c) : '';
      if (k) byKey[k] = c;
    });
    var at = _from(old.firstChild, o);
    Array.prototype.slice.call(next.childNodes).forEach(function (/** @type {Node} */ nc) {
      var k = nc.nodeType === 1 ? key(nc) : '';
      var match = k ? byKey[k] || null : at;
      if (k) delete byKey[k];
      if (match && _same(match, nc, key)) {
        if (match === at) at = _from(at.nextSibling, o);
        else old.insertBefore(match, at);
        var el = /** @type {Element} */ (match);
        if (match.nodeType === 1 && o.fresh && o.fresh(el)) {
          // Meant to be replaced whole.
          old.replaceChild(nc, match);
        } else if (match.nodeType === 1) _element(el, /** @type {Element} */ (nc), o);
        else if (match.nodeValue !== nc.nodeValue) match.nodeValue = nc.nodeValue;
        return;
      }
      old.insertBefore(nc, at);
    });
    while (at) {
      var gone = at;
      at = _from(at.nextSibling, o);
      old.removeChild(gone);
    }
  }

  /** Draws `html` into `root`, keeping the parts that did not change.
   * @param {Element} root @param {string | DocumentFragment} html @param {KeepOptions} [opts] */
  function patch(root, html, opts) {
    var content = html;
    if (typeof html === 'string') {
      var tpl = document.createElement('template');
      // html-safe: the caller's markup, which escapes its own text; it is only read here
      tpl.innerHTML = html;
      content = tpl.content;
    }
    _children(root, /** @type {DocumentFragment} */ (content), opts || {});
  }

  return { patch: patch };
})();
