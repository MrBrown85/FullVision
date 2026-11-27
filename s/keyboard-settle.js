// @ts-check
/* The page after the on-screen keyboard closes. An iPhone page opened from
   the Home Screen can keep the height it had while the keyboard was up; the
   tab bar, pinned to the bottom of that height (position: sticky,
   s/page-view.css), is then drawn where the top of the keyboard was, over
   the page (a Philosophy 12 student's iPhone, Nov 27 2026). When a typing
   field lets go of the focus and no other field takes it, the page moves
   one pixel and back, which makes iOS measure the screen again. Where
   nothing is wrong it changes nothing. Not yet seen on a real iPhone: this
   Mac has no iPhone keyboard to test with (Colin chose to ship it and
   check on his phone). */
(function () {
  'use strict';
  var TYPED = /^(INPUT|TEXTAREA|SELECT)$/;
  var SETTLE_MS = 120;

  /** @param {any} el */
  function typing(el) {
    return !!el && (TYPED.test(el.tagName || '') || el.isContentEditable === true);
  }

  function settle() {
    // Focus went to another field: the keyboard is still up.
    if (typing(document.activeElement)) return;
    var x = window.scrollX || window.pageXOffset || 0;
    var y = window.scrollY || window.pageYOffset || 0;
    window.scrollTo(x, y > 0 ? y - 1 : y + 1);
    window.scrollTo(x, y);
  }

  document.addEventListener(
    'focusout',
    function (e) {
      if (typing(e.target)) setTimeout(settle, SETTLE_MS);
    },
    true,
  );
})();
