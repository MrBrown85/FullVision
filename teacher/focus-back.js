// @ts-check
/* focus-back.js — a dialog gives the focus back to what opened it, even when
   the page under it was drawn again while it was open.

   A dialog remembers the button or switch that opened it and puts the focus
   back there when it closes. The page can be drawn again while the dialog is
   up: Class Settings › Competencies draws once more when its level wording
   has loaded, and any page does when its class's data arrives. The draw
   puts a new button in place of the old one, so the dialog was handing the
   focus to a button no longer on the page, and Cancel left it nowhere (the
   "Change Grades?" question lost it in 1 run in 9 of its test under load,
   Nov 25, 2026).

   FocusBack.from(el) is called as the dialog opens and returns what the
   dialog calls as it closes. If the element is still on the page it takes
   the focus, as before. If not, the one drawn in its place does: the same
   id, else the same tag, name and data, at the same place among those that
   match. With no match the focus is left alone. */
window.FocusBack = (function () {
  'use strict';

  /** @param {Element} el @returns {string | null} */
  function _selector(el) {
    if (typeof CSS === 'undefined' || !CSS.escape) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    var parts = [];
    var attrs = el.attributes || [];
    for (var i = 0; i < attrs.length; i++) {
      var n = attrs[i].name;
      if (n.indexOf('data-') === 0 || n === 'name') parts.push('[' + n + '="' + CSS.escape(attrs[i].value) + '"]');
    }
    return parts.length ? el.tagName.toLowerCase() + parts.join('') : null;
  }

  /**
   * @param {Element | null} el what has the focus as the dialog opens
   * @returns {() => void} gives the focus back; the dialog calls it as it closes
   */
  function from(el) {
    var known = el && el.tagName && el !== document.body ? el : null;
    var sel = known ? _selector(known) : null;
    var like = sel ? Array.prototype.slice.call(document.querySelectorAll(sel)) : [];
    var at = like.indexOf(known);
    return function () {
      var to = /** @type {HTMLElement | null} */ (known);
      if (to && !to.isConnected) {
        var now = sel ? document.querySelectorAll(sel) : [];
        to = /** @type {HTMLElement | null} */ (now.length === like.length && at >= 0 ? now[at] : null);
      }
      try {
        if (to && typeof to.focus === 'function') to.focus();
      } catch (e) {
        /* nothing to give the focus to */
      }
    };
  }

  return { from: from };
})();
