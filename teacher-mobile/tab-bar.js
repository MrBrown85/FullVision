// @ts-check
/* tab-bar.js — the phone's tab bar: which tab shows as open, and the tab
   the teacher last used on this device, so the app reopens there (speed
   assessment P6). Students the first time, or when the saved tab is not
   one of the tabs. The key starts with td-, so signing out wipes it
   (shared/supabase.js, _clearDeviceData). teacher-mobile/shell.js calls
   this; nothing here draws a tab's screen.

   A fourth tab, Bulletins, is last in the bar only while the build flag
   `bulletins` is on (shared/build-flags.js; docs/plans/bulletins-plan.md,
   B1f): its button is added to the bar here, the one place it is made. With
   the flag off the page holds no fourth button, the bar has its three tabs as
   before, and a remembered Bulletins opens on Students. */
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

  var BULLETINS_BUTTON =
    '<button class="m-tab-item m-bulletin-tab" role="tab" aria-selected="false" data-tab="bulletins">' +
    '<svg class="m-tab-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="4" y="4" width="16" height="16" rx="3" /><path class="m-tab-mark" d="M9 4v5l1.5-1 1.5 1V4" /></svg>' +
    '<span class="m-tab-label">Bulletins</span></button>';

  // The Bulletins button, last in the bar, is there only with the flag on.
  function show() {
    var bar = document.getElementById('m-tab-bar');
    var has = bar && bar.querySelector('.m-tab-item[data-tab="bulletins"]');
    if (!bar || !!has === _bulletinsOn()) return;
    if (has) has.remove();
    // html-safe: fixed markup.
    else bar.insertAdjacentHTML('beforeend', BULLETINS_BUTTON);
  }

  // The tab bar shows `tab` as the open one.
  /** @param {string} tab */
  function paint(tab) {
    show();
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
