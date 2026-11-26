// @ts-check
/* top-bar.js — the top bar (renderDock in ui.js), drawn on each page change.

   The bar is drawn once. Moving between pages lights the new tab in place,
   so the sidebar button, the sync dot, Help and the teacher's name stay as
   they are and never flash (Colin, Nov 26, 2026); the bar is drawn again
   only when more than its lit tab has changed. The lit tab's pill glides
   over from the tab just left (shared/seg-glide.js). */
window.TopBar = (function () {
  'use strict';

  /** Where the lit tab's pill sits in its row, read before the bar changes.
   * A pill still gliding (a page that loads its scripts draws the bar twice)
   * is read where it has got to, so the glide carries on.
   * @param {HTMLElement} mount */
  function _litTab(mount) {
    var seg = mount.querySelector('.tb-seg');
    var on = seg && seg.querySelector('.tb-seg-active');
    if (!seg || !on) return null;
    var glide = seg.querySelector('.seg-glide');
    var box = (glide || on).getBoundingClientRect();
    return {
      href: glide ? '' : on.getAttribute('data-href'),
      x: box.left - seg.getBoundingClientRect().left + seg.scrollLeft,
      width: box.width,
    };
  }

  /** The bar without its tabs, and with Help's open state left out (Help
   * changes its button in place): equal when only the lit tab differs.
   * @param {string} html */
  function barKey(html) {
    return html
      .replace(/<div class="seg tb-seg">[\s\S]*?<\/div>/, '')
      .replace(/tb-help-btn( is-open)?"/, 'tb-help-btn"')
      .replace(/aria-expanded="(true|false)" aria-controls="help-panel"/, 'aria-controls="help-panel"');
  }

  /** Lights the tab the new bar lights, in place, when the tabs are the same
   * ones. False when they are not.
   * @param {HTMLElement} mount @param {string} html */
  function _relight(mount, html) {
    var seg = mount.querySelector('.tb-seg');
    var part = html.match(/<div class="seg tb-seg">([\s\S]*?)<\/div>/);
    if (!seg || !part) return false;
    var tabs = seg.querySelectorAll('.tb-seg-link');
    var want = part[1].match(/<a [^>]*>/g) || [];
    if (want.length !== tabs.length) return false;
    for (var i = 0; i < tabs.length; i++) {
      if (want[i].indexOf('data-href="' + tabs[i].getAttribute('data-href') + '"') < 0) return false;
    }
    tabs.forEach(function (a, k) {
      var on = want[k].indexOf('tb-seg-active') >= 0;
      a.classList.toggle('tb-seg-active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    return true;
  }

  /** @param {string} activePage */
  function draw(activePage) {
    var w = /** @type {any} */ (window);
    var mount = /** @type {any} */ (document.getElementById('dock-mount'));
    if (!mount || typeof w.renderDock !== 'function') return;
    var was = typeof mount.querySelector === 'function' ? _litTab(mount) : null;
    var html = w.renderDock(activePage);
    var kept = !!mount._fvDock && barKey(mount._fvDock) === barKey(html) && _relight(mount, html);
    mount._fvDock = html;
    // html-safe: renderDock's tabs, labels and icons are fixed markup (ui.js)
    if (!kept) mount.innerHTML = html;
    // On a phone the tabs scroll sideways; keep the open one in view.
    var seg = typeof mount.querySelector === 'function' ? mount.querySelector('.tb-seg') : null;
    var on = seg && seg.querySelector('.tb-seg-active');
    if (!seg || !on) return finish(kept);
    if (seg.scrollWidth > seg.clientWidth) {
      seg.scrollLeft = on.offsetLeft - seg.offsetLeft - (seg.clientWidth - on.offsetWidth) / 2;
    }
    if (was && was.href !== on.getAttribute('data-href') && w.SegGlide) {
      var from = { left: seg.getBoundingClientRect().left + was.x - seg.scrollLeft, width: was.width };
      w.SegGlide.run(seg, from, on.getBoundingClientRect());
    }
    finish(kept);
  }

  /** A bar drawn new gets the teacher's name and the sync dot's state.
   * @param {boolean} kept */
  function finish(kept) {
    if (kept) return;
    var w = /** @type {any} */ (window);
    if (typeof w._populateDockUser === 'function') w._populateDockUser();
    if (w.UI && typeof w.UI.refreshSyncStatusUI === 'function') w.UI.refreshSyncStatusUI();
  }

  return { draw: draw, barKey: barKey };
})();
