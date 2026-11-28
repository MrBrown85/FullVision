// @ts-check
/* preview-send.js: Send My Work inside Preview as Student (teacher/preview-student.js).

   The Check and Send screen is the student page's own (s/send.js, with
   s/send-note.js), run here on the host below: a small stand-in for the
   student page's `StudentPage`, which only s/send.js asks for. It is loaded
   before s/send.js, which adds its screen to it.

   Nothing is ever written, and this is the one place that guarantees it:
   - the state it gives s/send.js is Demo Mode's (`demo: true`), whose send
     keeps the chosen photos in this tab's memory and uploads nothing, and
     whose sent record lives in `state.demoSent`, in memory, not in the
     teacher's data;
   - the host has no `askClass`, the one function the student page uses to
     reach `student-submit`, so no route is ever asked;
   - the card behind it is drawn from the teacher's copy, which a send here
     never changes, so the card still shows Send My Work.
   Closing the preview empties the state, and the photos with it. */
// Only where the student page itself is not loaded (it never is in the teacher app).
/** @type {any} */ (window).StudentPage =
  /** @type {any} */ (window).StudentPage ||
  (function () {
    'use strict';
    /** @type {any[]} */
    var screens = [];
    /** @type {any} */
    var state = null;
    /** @type {any} */
    var draw = null;
    function paint(focus) {
      if (state && draw) draw(focus);
    }
    return {
      addScreens: function (m) {
        screens.push(m);
      },
      viewOf: function (s) {
        return (s && s.view) || null;
      },
      paint: paint,
      paintKeepingCaret: paint,
      whileCurrent: function (p) {
        return p;
      },
      later: function () {
        return false;
      },
      MESSAGES: {},
      // What s/send.js calls the host for (preview-send.js's own API, below, goes through these).
      _screens: screens,
      _set: function (s, fn) {
        state = s;
        draw = fn;
      },
    };
  })();

/** @type {any} */ (window).PreviewSend = (function () {
  'use strict';
  var SP = /** @type {any} */ (window).StudentPage;
  var hosted = !!(SP && SP._screens);
  /** @type {any} */
  var state = null;

  function each(fn) {
    SP._screens.forEach(function (m) {
      if (m) fn(m);
    });
  }

  /* A new preview of student `sid`: `redraw(focus)` draws the device's screen again. */
  function start(sid, redraw) {
    if (!hosted) return;
    state = {
      demo: true,
      preview: true,
      view: null,
      page: { student: { id: sid } },
      screen: 'assignments',
      send: null,
      sendAsk: null,
      demoSent: {},
      tab: 'assignments',
      segment: '',
      pick: '',
      card: '',
    };
    SP._set(state, redraw);
    each(function (m) {
      if (m.share) m.share(state);
    });
  }

  function end() {
    if (!state) return;
    var last = state;
    state = null;
    SP._set(null, null);
    // A new state is a sign-out for s/send.js: its photos and notes go.
    each(function (m) {
      if (m.share && last) m.share({});
    });
  }

  function mine(act) {
    return /^(send-|revise-open$)/.test(act);
  }

  /* A press on the send's buttons; true when it was one. `view` is the page as the cache draws it now. */
  function press(act, el, view) {
    if (!state || !mine(act)) return false;
    state.view = view;
    each(function (m) {
      if (m.click) m.click(act, el);
    });
    return true;
  }

  function input(el) {
    if (state)
      each(function (m) {
        if (m.input) m.input(el);
      });
  }

  function change(el) {
    if (state)
      each(function (m) {
        if (m.change) m.change(el);
      });
  }

  // The Check and Send screen, while it is open; '' otherwise.
  function screenHtml(view) {
    if (!state || state.screen !== 'send') return '';
    state.view = view;
    var m = SP._screens.filter(function (x) {
      return x.render && x.render.send;
    })[0];
    if (!m) return '';
    // Under .sp-view, which carries the student page's colours and buttons (s/page-view.css). Demo Mode's line becomes the preview's.
    var html = m.render
      .send(state)
      .replace('This is Demo Mode. Nothing is sent anywhere.', 'This is a preview. Nothing is sent.');
    return '<div class="sp-view">' + html + '</div>';
  }

  // The Unsend or Replace question over the card, or ''.
  function dialogHtml(view) {
    if (!state || !state.sendAsk || typeof SP.sendDialog !== 'function') return '';
    state.view = view;
    return SP.sendDialog(state);
  }

  return {
    start: start,
    end: end,
    press: press,
    // A new preview's start: the note typed and the photos chosen, heard on its overlay.
    listen: function (box, sid, redraw) {
      start(sid, redraw);
      box.addEventListener('input', function (e) {
        if (e.target && e.target.id === 'sp-send-note') input(e.target);
      });
      box.addEventListener('change', function (e) {
        if (e.target && e.target.classList && e.target.classList.contains('sp-send-input')) change(e.target);
      });
    },
    showing: function () {
      return !!state && state.screen === 'send';
    },
    screenHtml: screenHtml,
    dialogHtml: dialogHtml,
  };
})();
