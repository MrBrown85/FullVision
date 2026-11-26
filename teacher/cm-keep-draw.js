// @ts-check
/* cm-keep-draw.js — Class Settings is drawn over what is already on screen.

   Every tab click and every switch flipped drew the class list, the toolbar
   and the tab again from nothing: open menus closed, the scroll and the
   focus were lost, and the page flashed (Nov 26, 2026). CmKeepDraw.draw
   takes the new markup and changes the page into it: an element that is
   still there stays the same element, with only its attributes, text and
   children changed, so the class list, the toolbar, the header, the lit tab
   and every control that did not change are never replaced, and the sliders
   glide (shared/seg-glide.js) because the same bar stays.

   A part that really is something else is replaced whole: `fresh(old)` says
   so (the tab body when the tab changes, the whole detail when the class
   changes). Elements match by id, else by place and tag. A box the teacher
   is typing in keeps what was typed unless the page has a newer value of its
   own. The patching itself is keep-dom.js's, shared with the student list and
   the Assignments toolbar. */
window.CmKeepDraw = (function () {
  'use strict';

  /** @typedef {(old: Element) => boolean} CmFresh */

  /**
   * Changes what is inside `target` into `html`, keeping the elements that
   * are still there.
   * @param {Element} target
   * @param {string} html
   * @param {CmFresh} [fresh] true for an old element that is replaced whole
   */
  function draw(target, html, fresh) {
    window.KeepDom.patch(target, html, { fresh: fresh, began: CmKeepMenu.began });
  }

  /* What the last draw of #main showed, so the next one knows that the class
     or the tab changed and that part is replaced instead of changed. */
  var _drawn = { shape: '', tab: '' };

  /** Draws into a mount over what Class Settings already put there (found by
   * `own`), or from nothing when the mount holds another page.
   * @param {Element} mount @param {string} own @param {string} html */
  function paint(mount, own, html) {
    if (mount.querySelector && mount.querySelector(':scope > ' + own)) draw(mount, html);
    // html-safe: the markup comes from Class Settings' own renderers, which escape every text with esc.
    else mount.innerHTML = html;
  }

  /** Draws the detail into #main. `shape` names the class and mode shown
   * (a change replaces the whole detail), `tab` the tab (a change replaces
   * the tab body).
   * @param {Element} main @param {string} html @param {string} shape @param {string} tab */
  function paintMain(main, html, shape, tab) {
    var was = _drawn;
    _drawn = { shape: shape, tab: tab };
    if (main.querySelector && main.querySelector(':scope > .cm-layout > .cm-detail')) {
      draw(main, html, function (old) {
        if (old.classList.contains('cm-detail')) return shape !== was.shape;
        return old.id === 'cm-tabpanel' && tab !== was.tab;
      });
      // html-safe: as above.
    } else main.innerHTML = html;
  }

  /* The roster is wider than most windows (twelve columns). While columns
     are hidden off its right edge, the edge fades and a line says to scroll
     sideways, so the scrolling is plain to see. A roster kept from the last
     draw is listened to once. */
  function rosterCue() {
    var scroller = /** @type {HTMLElement | null} */ (document.querySelector('.cm-rs-scroll'));
    if (!scroller || !scroller.addEventListener) return;
    var box = scroller;
    function update() {
      var section = box.closest('.cm-rs-section');
      var note = document.getElementById('cm-rs-more');
      var more = box.scrollLeft + box.clientWidth < box.scrollWidth - 1;
      if (section) section.classList.toggle('cm-rs-more-right', more);
      if (note) note.hidden = box.scrollWidth <= box.clientWidth + 1;
    }
    if (!box.dataset.cue) {
      box.dataset.cue = '1';
      box.addEventListener('scroll', update, { passive: true });
    }
    update();
  }

  return { draw: draw, paint: paint, paintMain: paintMain, rosterCue: rosterCue };
})();
