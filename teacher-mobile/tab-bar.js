// @ts-check
/* tab-bar.js — the phone's tab bar: which tab shows as open, and the tab
   the teacher last used on this device, so the app reopens there (speed
   assessment P6). Students the first time, or when the saved tab is not
   one of the tabs. The key starts with td-, so signing out wipes it
   (shared/supabase.js, _clearDeviceData). teacher-mobile/shell.js calls
   this; nothing here draws a tab's screen.

   A fourth tab, Bulletins, is last in the bar only while the build flag
   `bulletins` is on (shared/build-flags.js; docs/plans/bulletins-plan.md,
   B1f). With it off the bar has the three tabs as before, its button stays
   hidden, and a remembered Bulletins opens on Students. */
window.MTabBar = (function () {
  'use strict';

  var KEY = 'td-mobile-tab';
  var BASE = ['students', 'observe', 'grade'];

  function _bulletinsOn() {
    var flags = /** @type {any} */ (window).BuildFlags;
    return !!(flags && typeof flags.on === 'function' && flags.on('bulletins'));
  }

  // The tabs in the bar, in order.
  function tabs() {
    return _bulletinsOn() ? BASE.concat('bulletins') : BASE.slice();
  }

  // The Bulletins button shows only with the flag on.
  function show() {
    var on = _bulletinsOn();
    document.querySelectorAll('.m-tab-item[data-tab="bulletins"]').forEach(function (t) {
      /** @type {HTMLElement} */ (t).hidden = !on;
    });
  }

  // The tab bar shows `tab` as the open one.
  /** @param {string} tab */
  function paint(tab) {
    document.querySelectorAll('.m-tab-item').forEach(function (t) {
      var isActive = t.getAttribute('data-tab') === tab;
      t.classList.toggle('m-tab-active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
      var icon = /** @type {HTMLElement | null} */ (t.querySelector('.m-tab-icon'));
      if (icon) icon.style.fill = isActive ? 'var(--active)' : 'none';
    });
  }

  // The tab to open on: the last one used on this device, else Students.
  function saved() {
    try {
      var tab = localStorage.getItem(KEY);
      return tab && tabs().indexOf(tab) !== -1 ? tab : 'students';
    } catch (e) {
      return 'students';
    }
  }

  /** @param {string} tab */
  function remember(tab) {
    try {
      if (tabs().indexOf(tab) !== -1) localStorage.setItem(KEY, tab);
    } catch (e) {
      /* storage off: the next open starts on Students */
    }
  }

  return { KEY: KEY, paint: paint, saved: saved, remember: remember, tabs: tabs, show: show };
})();
