// @ts-check
/* Settings on the student page (the gear; s/page-view.js draws it, s/app.js
   answers it): the parts that are not the session's. Text Size's words and
   the classes on <html> that draw the page at that size (s/student.css),
   and the keys for Settings and Log Out? over the page. Nothing here is
   stored or sent: the size is kept with the session, in s/app.js. */
window.StudentSettings = (function () {
  'use strict';

  // A Text Size this page knows, or '' (Normal) for anything else.
  function sizeOf(z) {
    return z === 'large' || z === 'larger' ? z : '';
  }

  // The Text Size on <html> (student.css zooms the page by it); '' is Normal.
  function apply(size) {
    if (typeof document === 'undefined' || !document.documentElement) return;
    var html = document.documentElement.classList;
    html.toggle('sp-size-large', size === 'large');
    html.toggle('sp-size-larger', size === 'larger');
  }

  /* Settings, and Log Out? from it: Escape closes it (Log Out? as Cancel
     does) and gives the focus back to the gear, and Tab goes round inside
     it. A set of choices is one Tab stop (student.js). `state()` is the
     page's state; `press(act)` answers as that button would. */
  function keys(state, press) {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    window.addEventListener('keydown', function (e) {
      var S = state();
      if (!S || S.screen !== 'assignments' || typeof document === 'undefined') return;
      var open = S.logout ? '.sp-logout' : S.settings ? '.sp-set' : S.handoutMenu ? '.sp-handout-sheet' : '';
      if (!open) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        // Save or Print over a handout closes as its Cancel does (s/handouts.js).
        var cancel =
          !S.logout && !S.settings && document.querySelector('.sp-handout-sheet [data-act="handout-out-close"]');
        if (cancel) /** @type {HTMLElement} */ (cancel).click();
        else press(S.logout ? 'logout-cancel' : 'settings-close');
        return;
      }
      if (e.key !== 'Tab') return;
      var inside = Array.prototype.slice.call(document.querySelectorAll(open + ' button:not([tabindex="-1"])'));
      if (!inside.length) return;
      var at = inside.indexOf(document.activeElement);
      var next = e.shiftKey ? (at <= 0 ? inside.length - 1 : at - 1) : at < 0 || at === inside.length - 1 ? 0 : at + 1;
      e.preventDefault();
      inside[next].focus();
    });
  }

  return { sizeOf: sizeOf, apply: apply, keys: keys };
})();
