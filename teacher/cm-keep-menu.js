// @ts-check
/* cm-keep-menu.js — Class Settings: what the teacher is in the middle of
   stays when Class Settings is drawn again.

   The class's data arriving from the server draws the page again, up to a
   second after a class is picked, and the Competencies tab draws once more
   when its level wording has loaded. That closed Class Actions or a
   student's menu under the teacher's pointer, threw away what the teacher
   was typing in a box, and took the focus off whatever had it, so the next
   key went nowhere (Nov 25, 2026). DashClassManager takes a mark before it
   draws and hands it back after.

   A menu is found again by its button's place among the menu buttons and
   what the button says, in the same class, tab and mode, and the focus goes
   back to the same item. A click or Escape closes menus before anything is
   drawn, so a menu the teacher closed is never opened again.

   The button, switch, menu or box with the focus is found again by its place
   among its kind and what it is (its id, name, hint and data), in the same
   class, tab and mode, and gets the focus back unless the draw put the focus
   somewhere itself. One that is gone, hidden or greyed out leaves the focus
   where the draw left it.

   A box also gets the cursor back. It gets the unsaved typing back only when
   the page still holds the value the typing began from: a draw that saved
   the box, cancelled it, or brought a newer value from the server shows that
   value. Typing put back this way is saved when the teacher leaves the box,
   as typing is. The only thing this file remembers is what each box held
   when the teacher went into it. */
window.CmKeepMenu = (function () {
  'use strict';

  /** @typedef {{ at: number, says: string, item: number }} CmMenuMark */
  /** @typedef {{ was: string, typed: string, from: number | null, to: number | null, scroll: number }} CmBoxMark */
  /** @typedef {{ tag: string, at: number, is: string, box: CmBoxMark | null }} CmFocusMark */
  /** @typedef {{ where: string, menu: CmMenuMark | null, focus: CmFocusMark | null }} CmMark */
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

  /** Every control of one kind in Class Settings and its class list. @param {string} tag @returns {HTMLElement[]} */
  function _all(tag) {
    var t = tag.toLowerCase();
    return Array.prototype.slice.call(document.querySelectorAll('#main ' + t + ', #sidebar-mount ' + t));
  }

  /** What a control is, whatever it holds or shows. @param {HTMLElement} el */
  function _is(el) {
    /** @param {string} n */
    var a = function (n) {
      return el.getAttribute(n) || '';
    };
    var held = /^(radio|checkbox)$/.test(a('type')) ? a('value') : '';
    return [
      el.tagName,
      a('type'),
      el.id,
      a('name'),
      a('placeholder'),
      a('role'),
      a('href'),
      held,
      JSON.stringify(el.dataset),
    ].join('|');
  }

  /** @param {CmBox} el @returns {CmBoxMark} */
  function _markBox(el) {
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
    return { was: _began(el), typed: el.value, from: from, to: to, scroll: el.scrollTop };
  }

  /** @returns {CmFocusMark | null} */
  function _markFocus() {
    var el = /** @type {HTMLElement | null} */ (document.activeElement);
    if (!el || el === document.body || !el.closest('#main, #sidebar-mount')) return null;
    return { tag: el.tagName, at: _all(el.tagName).indexOf(el), is: _is(el), box: _isBox(el) ? _markBox(el) : null };
  }

  /** @param {CmFocusMark} m @returns {HTMLElement | null} */
  function _again(m) {
    var all = _all(m.tag);
    if (all[m.at] && _is(all[m.at]) === m.is) return all[m.at];
    var same = all.filter(function (el) {
      return _is(el) === m.is;
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

  /** @param {CmBox} el @param {CmBoxMark} m */
  function _typeAgain(el, m) {
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

  /** @param {CmFocusMark} m */
  function _focusAgain(m) {
    var active = document.activeElement;
    if (active && active !== document.body) return; // the draw put the focus somewhere on purpose
    var el = _again(m);
    if (!el || /** @type {HTMLButtonElement} */ (el).disabled) return;
    el.focus({ preventScroll: true });
    if (m.box && _isBox(el) && !el.readOnly && document.activeElement === el) _typeAgain(el, m.box);
  }

  /**
   * The open menu and what has the focus, if anything. `where` names the class, tab and mode on screen.
   * @param {string} where
   * @returns {CmMark}
   */
  function mark(where) {
    return { where: where, menu: _markMenu(), focus: _markFocus() };
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
    if (m.focus) _focusAgain(m.focus);
  }

  return { mark: mark, restore: restore, began: _began };
})();
