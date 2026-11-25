// @ts-check
/* cm-keep-menu.js — Class Settings: a menu that is open when Class Settings
   is drawn again stays open.

   The class's data arriving from the server draws the page again, up to a
   second after a class is picked, and that closed Class Actions or a
   student's menu under the teacher's pointer (Nov 25, 2026). DashClassManager
   takes a mark before it draws and hands it back after. The menu is found
   again by its button's place among the menu buttons and what the button
   says, in the same class, tab and mode, and the focus goes back to the same
   item. A click or Escape closes menus before anything is drawn, so a menu
   the teacher closed is never opened again. It keeps no state of its own. */
window.CmKeepMenu = (function () {
  'use strict';

  /** @typedef {{ at: number, says: string, item: number, where: string }} CmMenuMark */

  /** @returns {HTMLElement[]} */
  function _buttons() {
    return Array.prototype.slice.call(document.querySelectorAll('#main [data-action="cmStdMenu"]'));
  }

  /** @param {HTMLElement} btn */
  function _says(btn) {
    return [btn.textContent, btn.getAttribute('aria-label') || '', JSON.stringify(btn.dataset)].join('|');
  }

  /**
   * The open menu, if there is one. `where` names the class, tab and mode on screen.
   * @param {string} where
   * @returns {CmMenuMark | null}
   */
  function mark(where) {
    var menu = /** @type {HTMLElement | null} */ (document.querySelector('#main .cm-std-menu:not([hidden])'));
    var wrap = menu && menu.parentElement;
    var btn = /** @type {HTMLElement | null} */ (wrap && wrap.querySelector('[data-action="cmStdMenu"]'));
    if (!menu || !btn) return null;
    var items = Array.prototype.slice.call(menu.querySelectorAll('.cm-std-menu-item'));
    return { at: _buttons().indexOf(btn), says: _says(btn), item: items.indexOf(document.activeElement), where: where };
  }

  /**
   * Opens the marked menu again after a draw. `place` puts a menu that floats over a scrolling list.
   * @param {CmMenuMark | null} m
   * @param {string} where
   * @param {(menu: HTMLElement, btn: HTMLElement) => void} place
   */
  function reopen(m, where, place) {
    if (!m || m.where !== where) return;
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

  return { mark: mark, reopen: reopen };
})();
