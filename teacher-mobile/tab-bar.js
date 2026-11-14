// @ts-check
/* tab-bar.js — the phone's tab bar: which tab shows as open, and the tab
   the teacher last used on this device, so the app reopens there (speed
   assessment P6). Students the first time, or when the saved tab is not
   one of the three. The key starts with td-, so signing out wipes it
   (shared/supabase.js, _clearDeviceData). teacher-mobile/shell.js calls
   this; nothing here draws a tab's screen. */
window.MTabBar = (function () {
  'use strict';

  var KEY = 'td-mobile-tab';
  var TABS = ['students', 'observe', 'grade'];

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
      return tab && TABS.indexOf(tab) !== -1 ? tab : 'students';
    } catch (e) {
      return 'students';
    }
  }

  /** @param {string} tab */
  function remember(tab) {
    try {
      if (TABS.indexOf(tab) !== -1) localStorage.setItem(KEY, tab);
    } catch (e) {
      /* storage off: the next open starts on Students */
    }
  }

  return { KEY: KEY, paint: paint, saved: saved, remember: remember };
})();
