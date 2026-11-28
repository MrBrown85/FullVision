// @ts-check
/* The Add to Home Screen card on the student page. An iPhone or iPad keeps a
   Home Screen app's storage apart from Safari's, so a student who signs in
   in Safari and then adds the page to the Home Screen has to sign in again
   inside the app. The card asks first, on the card sign-in screen, so the
   one sign-in is the app's. It shows in Safari on an iPhone or iPad only,
   never once the page is open from the Home Screen, and "Not Now" hides it
   on this device for good. The key holds no student data, so signing out
   leaves it alone. The teacher's Preview as Student does not load this file. */
/** @type {any} */ (window).HomeScreenCard = (function () {
  'use strict';

  var KEY = 'sp-a2hs-dismissed';
  var shown = false;

  /** @param {any} nav @param {any} win */
  function inSafariOnIos(nav, win) {
    var ua = (nav && nav.userAgent) || '';
    var ios = /iPhone|iPad|iPod/.test(ua) || (nav && nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
    return !!ios && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) && !!win;
  }

  /** @param {any} nav @param {any} win */
  function isStandalone(nav, win) {
    if (nav && nav.standalone === true) return true;
    try {
      return !!(win && win.matchMedia && win.matchMedia('(display-mode: standalone)').matches);
    } catch (e) {
      return false;
    }
  }

  /** @param {any} store */
  function dismissed(store) {
    try {
      return !!store && store.getItem(KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  /** True when the card is to be drawn: `env` is {nav, win, store}. */
  function shouldShow(env) {
    return inSafariOnIos(env.nav, env.win) && !isStandalone(env.nav, env.win) && !dismissed(env.store);
  }

  var SHARE =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 15V4M8.5 7.5L12 4l3.5 3.5M7 10H6a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 18 10h-1"/></svg>';
  var PLUS =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M12 8.5v7M8.5 12h7"/></svg>';

  /** The card; `once` adds the line a signed-in student sees. */
  function html(once) {
    return (
      '<section class="sp-a2hs" aria-label="Add to Home Screen">' +
      '<h2 class="sp-a2hs-title">Add FullVision to Your Home Screen</h2>' +
      '<ol class="sp-a2hs-steps">' +
      '<li><span class="sp-a2hs-n">1</span>' +
      SHARE +
      '<span>Share</span></li>' +
      '<li><span class="sp-a2hs-n">2</span>' +
      PLUS +
      '<span>Add to Home Screen</span></li>' +
      '</ol>' +
      (once ? '<p class="sp-a2hs-line">You’ll sign in once in the app.</p>' : '') +
      '<button type="button" class="sp-a2hs-no" data-act="a2hs-no">Not Now</button>' +
      '</section>'
    );
  }

  /* Once a screen is drawn into `root`: the card goes in at the top of the
     card sign-in screens (a phone opening the page without a code too), and of the student's page after sign-in. */
  /** @param {any} root @param {any} state */
  function draw(root, state) {
    if (!root || !state || root.querySelector('.sp-a2hs')) return;
    /** @type {any} */
    var store = null;
    try {
      store = window.localStorage;
    } catch (e) {
      /* no storage: the card shows each visit */
    }
    if (!shouldShow({ nav: typeof navigator === 'undefined' ? null : navigator, win: window, store: store })) return;
    /** @type {any} */
    var host = null;
    /** @type {any} */
    var after = null;
    if (state.screen === 'cardstart') {
      host = root.querySelector('.sp-card-start');
      after = host && host.querySelector('.sp-brand');
    } else if (state.screen === 'start') {
      host = root.querySelector('main.sp-main-center');
    } else if (state.screen === 'assignments') {
      host = root.querySelector('.sp-view:not(.sp-on-feedback) main.sp-page');
    } else return;
    if (!host) return;
    var wrap = document.createElement('div');
    // html-safe: html() is this file's fixed markup with no student or typed text.
    wrap.innerHTML = html(state.screen === 'assignments');
    var card = wrap.firstChild;
    if (card) host.insertBefore(card, after ? after.nextSibling : host.firstChild);
    // Bulletins opens scrolled to what is new; the card is at the top, so the page goes up to it once.
    if (card && state.screen === 'assignments' && !shown) {
      shown = true;
      setTimeout(function () {
        window.scrollTo(0, 0);
      }, 350);
    }
  }

  /** @param {string} act @param {any} el */
  function click(act, el) {
    if (act !== 'a2hs-no') return;
    try {
      window.localStorage.setItem(KEY, '1');
    } catch (e) {
      /* nothing kept: it hides until the next visit */
    }
    var card = el.closest('.sp-a2hs');
    if (card) card.remove();
  }

  var host = /** @type {any} */ (window).StudentPage;
  if (host && host.addScreens) {
    host.addScreens({
      file: 'home-screen-card',
      render: {},
      drawn: draw,
      click: click,
      share: function () {},
      test: {},
    });
  }

  return { shouldShow: shouldShow, html: html, KEY: KEY };
})();
