// @ts-check
/* screen-keep.js — what a phone screen keeps when it is drawn again from the
   data: after a sync, after the class is read again, or when its tab is come
   back to. Where it was scrolled, the rows open on it and, in the grader,
   the same students with the same one on screen. shell.js captures before
   the redraw and restores after.

   The grader used to come back by its place in the list, and a list of only
   the work waiting was worked out again. Two seconds after a teacher stops
   choosing levels the app reads which grades are drafts and redraws; the
   student just graded had left the waiting list, so the next student's card,
   with no levels, took their place (Colin, Nov 25 2026). The profile came
   back at its top with its open row shut. */
/** @type {any} */ (window).MScreenKeep = (function () {
  'use strict';
  var W = /** @type {any} */ (window);

  /** @param {Element} screen @param {string} sel @returns {Element[]} */
  function _all(screen, sel) {
    return Array.prototype.slice.call(screen.querySelectorAll(sel));
  }
  /** @param {Element} card */
  function _sid(card) {
    return card.getAttribute('data-sid');
  }

  var TAPPED =
    '.m-section-card[aria-expanded="true"], .m-sp-more[aria-expanded="true"], .m-seg-btn.m-seg-active[data-action="m-grade-seg"]';
  var UNTAPPED =
    '.m-section-card[aria-expanded="false"], .m-sp-more[aria-expanded="false"], .m-seg-btn[data-action="m-grade-seg"]:not(.m-seg-active)';
  /** @param {Element} screen @param {Element} el */
  function _tapKey(screen, el) {
    if (el.classList.contains('m-sp-more')) return 'more:' + _all(screen, '.m-sp-more').indexOf(el);
    return el.getAttribute('data-sec') ? 'sec:' + el.getAttribute('data-sec') : 'seg:' + el.getAttribute('data-val');
  }

  /** @param {Element} screen */
  function capture(screen) {
    var content = screen.querySelector('.m-screen-content');
    var cards = _all(screen, '#m-swiper .m-swiper-card');
    var idx = cards.length ? W.MGrade.getCurrentIndex() : 0;
    return {
      scrollTop: content ? content.scrollTop : 0,
      // The rows open on the screen (<details>), by their label.
      open: _all(screen, 'details[open] > summary .m-sp-row-label').map(function (l) {
        return l.textContent;
      }),
      // What a tap opened: the profile's competencies (by section) and long
      // answers (by their place), and the Grade list's segment.
      tapped: _all(screen, TAPPED).map(_tapKey.bind(null, screen)),
      grade: cards.length
        ? {
            idx: idx,
            sid: cards[idx] ? _sid(cards[idx]) : null,
            // The students a screen of only the work waiting holds, in order;
            // none when it shows the whole class.
            ids: W.MGrade.gradingOnly() === 'tograde' ? cards.map(_sid) : [],
            scrolls: W.MGrade.getCardScrolls(),
          }
        : null,
    };
  }

  /** @param {Element} screen @param {ReturnType<typeof capture> | null | undefined} kept */
  function restore(screen, kept) {
    if (!kept) return;
    _all(screen, 'details > summary .m-sp-row-label').forEach(function (l) {
      var row = /** @type {HTMLDetailsElement | null} */ (l.closest('details'));
      if (row && kept.open.indexOf(l.textContent) !== -1) row.open = true;
    });
    // Tapped again, as the teacher did, where the redraw shut it.
    kept.tapped.forEach(function (key) {
      var el = /** @type {HTMLElement | undefined} */ (
        _all(screen, UNTAPPED).filter(function (e) {
          return _tapKey(screen, e) === key;
        })[0]
      );
      if (!el) return;
      // A long answer's button shows once the answer is measured as cut,
      // and an open one is not measured: it was long, so it says so.
      if (el.classList.contains('m-sp-more') && el.parentElement) el.parentElement.classList.add('is-long');
      el.click();
    });
    var g = kept.grade;
    var cards = _all(screen, '#m-swiper .m-swiper-card');
    if (g && cards.length) {
      // The same student, wherever their card now is; their place only if they are gone.
      var at = cards.map(_sid).indexOf(g.sid);
      W.MGrade.jumpToStudent(at !== -1 ? at : Math.min(g.idx, cards.length - 1), true);
      W.MGrade.setCardScrolls(g.scrolls);
    }
    var content = screen.querySelector('.m-screen-content');
    if (!content) return;
    // Bulletins fills its feed a moment after its screen is drawn, and its
    // pictures give it height later still: the scroll is set again each
    // frame until the content is long enough (half a second at most), or
    // the teacher touches the screen.
    var tries = 30;
    var stop = function () {
      tries = 0;
    };
    content.addEventListener('touchstart', stop, { once: true, passive: true });
    (function set() {
      if (!content) return;
      content.scrollTop = kept.scrollTop;
      if (content.scrollTop !== kept.scrollTop && tries-- > 0) requestAnimationFrame(set);
      else content.removeEventListener('touchstart', stop);
    })();
  }

  return { capture: capture, restore: restore };
})();
