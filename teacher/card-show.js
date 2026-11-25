// @ts-check
/* card-show.js — Show on Screen: a student card just made, large, over the
   page, one student at a time (teacher/student-cards.js makes the cards and
   draws each one with its own cardHtml). */
/** @type {any} */ (window).CardShow = (function () {
  'use strict';
  /** @param {string} t */
  function esc(t) {
    return /** @type {any} */ (window).esc(t);
  }

  /* Show on Screen (Colin, Nov 24 2026): the cards just made, up on this
     screen one student at a time, for a student beside the teacher to scan
     or type, with nothing printed. The card is the printed one (cardHtml),
     drawn large. Next and Back step through; Done, Escape or the backdrop
     close it, and the codes go with it (Print Again still has them for its
     hour). A card's code can never be shown again later: the database
     keeps only its fingerprint (DECISIONS, "Card codes the database cannot
     read"), so a lost card is replaced, not shown again. */
  // The QR maker (vendor/qrcode.js) loads on first use, as printing loads it (router.js withScripts).
  function open(items, cardOf) {
    if (typeof document === 'undefined' || !items || !items.length) return;
    var R = /** @type {any} */ (window).Router;
    if (R && R.withScripts && typeof (/** @type {any} */ (window).qrcode) !== 'function') {
      R.withScripts('qrcode', function () {
        draw0(items, cardOf);
      });
      return;
    }
    draw0(items, cardOf);
  }
  function draw0(items, cardOf) {
    var at = 0;
    /** @type {any} */
    var trigger = document.activeElement;
    var old = document.getElementById('sc-show');
    if (old) old.remove();
    var overlay = document.createElement('div');
    overlay.id = 'sc-show';
    overlay.className = 'sc-show-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'sc-show-title');
    var close = function () {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      try {
        if (trigger && trigger.isConnected && typeof trigger.focus === 'function') trigger.focus();
      } catch (e) {
        /* the button that opened it may have gone */
      }
    };
    var draw = function () {
      var item = items[at];
      var last = at === items.length - 1;
      var next = last ? null : items[at + 1];
      // html-safe: names through esc; the card from student-cards.js's cardHtml, which escapes; counts are numbers
      overlay.innerHTML =
        '<div class="sc-show">' +
        '<div class="sc-show-head"><h2 class="sc-show-title" id="sc-show-title">' +
        esc(item.name + '\u2019s Card') +
        '</h2>' +
        (items.length > 1 ? '<span class="sc-show-count">' + (at + 1) + ' of ' + items.length + '</span>' : '') +
        '</div>' +
        '<div class="qs-slip sc-show-card">' +
        cardOf(item) +
        '</div>' +
        '<div class="sc-show-actions">' +
        (at > 0 ? '<button type="button" class="btn btn-ghost" data-sc-show="back">Back</button>' : '') +
        '<span class="sc-show-spacer"></span>' +
        (last
          ? '<button type="button" class="btn btn-primary" data-sc-show="done">Done</button>'
          : '<button type="button" class="btn btn-ghost" data-sc-show="done">Done</button>' +
            '<button type="button" class="btn btn-primary" data-sc-show="next">' +
            esc('Next: ' + next.name) +
            '</button>') +
        '</div></div>';
      /** @type {any} */
      var primary = overlay.querySelector('.btn-primary');
      if (primary) primary.focus();
    };
    var onKey = function (e) {
      if (!overlay.isConnected) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === 'ArrowRight' && at < items.length - 1) {
        at++;
        draw();
      } else if (e.key === 'ArrowLeft' && at > 0) {
        at--;
        draw();
      } else if (e.key === 'Tab') {
        var buttons = overlay.querySelectorAll('button');
        var first = buttons[0];
        var lastBtn = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          lastBtn.focus();
        } else if (!e.shiftKey && document.activeElement === lastBtn) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    overlay.addEventListener('click', function (e) {
      /** @type {any} */
      var t = e.target;
      if (t === overlay) return close();
      var b = t && t.closest && t.closest('[data-sc-show]');
      if (!b) return;
      var what = b.getAttribute('data-sc-show');
      if (what === 'done') return close();
      at = Math.max(0, Math.min(items.length - 1, at + (what === 'next' ? 1 : -1)));
      draw();
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    draw();
  }

  return { open: open };
})();
