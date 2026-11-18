// @ts-check
/* pin-page.js — the phone app's page stays put.
   The page is pinned to the screen (styles.css, body.mobile-mode) and only
   each screen's content scrolls. iOS can still leave the page itself
   scrolled: it puts a scroll back after a reload, scrolls the page to show a
   field the keyboard would cover and does not always scroll it back, and can
   lose its place on a turn. That slides the tab bar up and shows a strip
   under it, so whenever the page is found scrolled and no field is being
   typed in, it goes back to the top. */

(function () {
  'use strict';

  function _pinPage() {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    function typing() {
      var a = document.activeElement;
      return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
    }
    function settle() {
      if ((window.scrollY || window.scrollX) && !typing()) window.scrollTo(0, 0);
    }
    window.addEventListener('scroll', settle, { passive: true });
    window.addEventListener('pageshow', settle);
    window.addEventListener('orientationchange', function () {
      setTimeout(settle, 300);
    });
    document.addEventListener('focusout', function () {
      setTimeout(settle, 0);
    });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', settle);
  }

  _pinPage();
})();
