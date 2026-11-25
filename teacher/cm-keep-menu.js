// @ts-check
/* cm-keep-menu.js — Class Settings: what the teacher is in the middle of
   stays when Class Settings is drawn again.

   The class's data arriving from the server draws the page again, up to a
   second after a class is picked. That closed Class Actions or a student's
   menu under the teacher's pointer, and it threw away what the teacher was
   typing in a box and took the focus off it (Nov 25, 2026). DashClassManager
   takes a mark before it draws and hands it back after.

   A menu is found again by its button's place among the menu buttons and
   what the button says, in the same class, tab and mode, and the focus goes
   back to the same item. A click or Escape closes menus before anything is
   drawn, so a menu the teacher closed is never opened again.

   A box is found again by its place among the boxes and what it is (its id,
   name, hint and data), in the same class, tab and mode. It gets the focus
   and the cursor back. It gets the unsaved typing back only when the page
   still holds the value the typing began from: a draw that saved the box,
   cancelled it, or brought a newer value from the server shows that value.
   Typing put back this way is saved when the teacher leaves the box, as
   typing is. The only thing this file remembers is what each box held when
   the teacher went into it. */
window.CmKeepMenu = (function () {
  'use strict';

  /** @typedef {{ at: number, says: string, item: number }} CmMenuMark */
  /** @typedef {{ at: number, says: string, was: string, typed: string, from: number | null, to: number | null, scroll: number }} CmBoxMark */
  /** @typedef {{ where: string, menu: CmMenuMark | null, box: CmBoxMark | null }} CmMark */
  /** @typedef {HTMLInputElement | HTMLTextAreaElement} CmBox */

  /** @returns {HTMLElement[]} */
  function _buttons() {
    return Array.prototype.slice.call(document.querySelectorAll('#main [data-action="cmStdMenu"]'));
  }

  /** @param {HTMLElement} btn */
  function _says(btn) {
    return [btn.textContent, btn.getAttribute('aria-label') || '', JSON.stringify(btn.dataset)].join('|');
  }

  /** @returns {CmMenuMark | null} */
  function _markMenu() {
    var menu = /** @type {HTMLElement | null} */ (document.querySelector('#main .cm-std-menu:not([hidden])'));
    var wrap = menu && menu.parentElement;
    var btn = /** @type {HTMLElement | null} */ (wrap && wrap.querySelector('[data-action="cmStdMenu"]'));
    if (!menu || !btn) return null;
    var items = Array.prototype.slice.call(menu.querySelectorAll('.cm-std-menu-item'));
    return { at: _buttons().indexOf(btn), says: _says(btn), item: items.indexOf(document.activeElement) };
  }

  /**
   * @param {CmMenuMark} m
   * @param {(menu: HTMLElement, btn: HTMLElement) => void} place
   */
  function _reopenMenu(m, place) {
    var btn = _buttons()[m.at];
    if (!btn || _says(btn) !== m.says) return;
    var menu = /** @type {HTMLElement | null} */ (btn.parentElement && btn.parentElement.querySelector('.cm-std-menu'));
    if (!menu || !menu.hidden) return;
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    place(menu, btn);
    var item = /** @type {HTMLElement | undefined} */ (menu.querySelectorAll('.cm-std-menu-item')[m.item]);
    if (item) item.focus({ preventScroll: true });
  }

  /** A box the teacher types words or numbers into. @param {Element | null} el @returns {el is CmBox} */
  function _isBox(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    return (
      el.tagName === 'INPUT' && /^(text|search|number|email|url|tel)$/.test(/** @type {HTMLInputElement} */ (el).type)
    );
  }

  /* What each box held when the teacher went into it: the value the typing
     began from. A box saved in place, with no draw, still carries the value
     it was first drawn with, so that is only the fallback. */
  /** @type {WeakMap<Element, string>} */
  var _from = new WeakMap();
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function')
    document.addEventListener('focusin', function (e) {
      var el = /** @type {Element | null} */ (e.target);
      if (_isBox(el)) _from.set(el, el.value);
    });

  /** @param {CmBox} el */
  function _began(el) {
    var from = _from.get(el);
    return from == null ? el.defaultValue : from;
  }

  /** @returns {CmBox[]} */
  function _boxes() {
    return Array.prototype.filter.call(document.querySelectorAll('#main input, #main textarea'), _isBox);
  }

  /** @param {CmBox} el */
  function _boxSays(el) {
    return [el.tagName, el.type, el.id, el.getAttribute('name') || '', el.placeholder, JSON.stringify(el.dataset)].join(
      '|',
    );
  }

  /** @returns {CmBoxMark | null} */
  function _markBox() {
    var el = document.activeElement;
    if (!_isBox(el) || !el.closest('#main')) return null;
    /** @type {number | null} */
    var from = null;
    /** @type {number | null} */
    var to = null;
    try {
      from = el.selectionStart;
      to = el.selectionEnd;
    } catch (e) {
      /* a number box has no cursor to read */
    }
    return {
      at: _boxes().indexOf(el),
      says: _boxSays(el),
      was: _began(el),
      typed: el.value,
      from: from,
      to: to,
      scroll: el.scrollTop,
    };
  }

  /** @param {CmBoxMark} m @returns {CmBox | null} */
  function _boxAgain(m) {
    var all = _boxes();
    if (all[m.at] && _boxSays(all[m.at]) === m.says) return all[m.at];
    var same = all.filter(function (el) {
      return _boxSays(el) === m.says;
    });
    return same.length === 1 ? same[0] : null;
  }

  /* The browser tells the page a box changed only after the teacher's own
     keys, so typing put back by the page is told here, once, when the
     teacher leaves the box without typing more. */
  /** @param {CmBox} el */
  function _saveOnLeave(el) {
    var was = _began(el);
    var told = false;
    el.addEventListener('change', function () {
      told = true;
    });
    el.addEventListener(
      'blur',
      function () {
        if (!told && el.isConnected && el.value !== was) el.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { once: true },
    );
  }

  /** @param {CmBoxMark} m */
  function _typeAgain(m) {
    var active = document.activeElement;
    if (active && active !== document.body) return; // the draw put the focus somewhere on purpose
    var el = _boxAgain(m);
    if (!el || el.disabled || el.readOnly) return;
    el.focus({ preventScroll: true });
    _from.set(el, el.value);
    if (m.typed !== m.was && el.value === m.was) {
      el.value = m.typed;
      _saveOnLeave(el);
    }
    try {
      if (m.from != null && m.to != null) el.setSelectionRange(m.from, m.to);
    } catch (e) {
      /* a number box has no cursor to set */
    }
    el.scrollTop = m.scroll;
  }

  /**
   * The open menu and the box being typed in, if there is one. `where` names the class, tab and mode on screen.
   * @param {string} where
   * @returns {CmMark}
   */
  function mark(where) {
    return { where: where, menu: _markMenu(), box: _markBox() };
  }

  /**
   * Puts back what was marked, after a draw. `place` puts a menu that floats over a scrolling list.
   * @param {CmMark | null} m
   * @param {string} where
   * @param {(menu: HTMLElement, btn: HTMLElement) => void} place
   */
  function restore(m, where, place) {
    if (!m || m.where !== where) return;
    if (m.menu) _reopenMenu(m.menu, place);
    if (m.box) _typeAgain(m.box);
  }

  return { mark: mark, restore: restore };
})();
