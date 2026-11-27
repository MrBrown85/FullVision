// @ts-check
/* settings-sheet.js — the phone's Settings sheet from the top bar's ⋯, drawn
   in the phone's form style (Nov 26 2026): Done at the right, the account,
   Help and Switch to Desktop as rows, Sign Out as a filled button. The time of
   the last sync is a quiet row, shown only when there is one; the sync dot
   carries every sync problem. shell.js opens it. */
(function () {
  'use strict';
  /** @type {any} */
  var w = window;

  var CHEVRON =
    '<svg class="m-set-chev" width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 1.5l5 5-5 5"/></svg>';

  /** html-safe: the name, email, time and version go through MComponents.esc; the rest is fixed markup.
   * @param {{name?: string, email?: string, syncedAt?: any, version: string}} o */
  function html(o) {
    var MC = w.MComponents;
    var syncRow = o.syncedAt
      ? '<div class="m-form-row m-set-row"><span>Last Synced</span><span class="m-set-value">' +
        MC.esc(MC.relativeTime(String(o.syncedAt))) +
        '</span></div>'
      : '';
    var account =
      o.name || o.email
        ? '<div class="m-set-account">' +
          (o.name ? '<div class="m-set-name">' + MC.esc(o.name) + '</div>' : '') +
          (o.email ? '<div class="m-set-email">' + MC.esc(o.email) + '</div>' : '') +
          '</div>'
        : '';
    return (
      '<div class="m-set-sheet">' +
      '<div class="m-set-head"><span aria-hidden="true"></span><h2 class="m-set-title">Settings</h2>' +
      '<button type="button" class="m-set-done" data-action="m-sheet-cancel">Done</button></div>' +
      account +
      '<div class="m-set-list">' +
      syncRow +
      // Help opens the help site in a new tab.
      '<a class="m-form-row m-set-row m-help-link" href="/help" target="_blank" rel="noopener"><span>Help</span>' +
      CHEVRON +
      '</a>' +
      '<button type="button" class="m-form-row m-set-row" data-action="m-switch-desktop"><span>Switch to Desktop</span>' +
      CHEVRON +
      '</button>' +
      '</div>' +
      '<button type="button" class="m-btn-primary m-set-signout" data-action="m-sign-out">Sign Out</button>' +
      '<div class="m-set-version">FullVision v' +
      MC.esc(o.version) +
      '</div>' +
      '</div>'
    );
  }

  w.MSettingsSheet = { html: html };
})();
