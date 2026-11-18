// @ts-check
/* What the student has really looked at, on the student page: the one rule
   returned work (s/app.js) and bulletins (s/bulletins.js) both use
   (docs/plans/bulletins-plan.md, "What exists already": "Bulletins use the
   same rule and the same watcher"). Moved here unchanged from s/app.js.

   A row counts as seen once it has been on screen in a visible tab (Colin,
   Nov 10), and stayed there: a row counts only if it is still in view when
   SEEN_AFTER_MS is up. A flick down the list passes every row and reads
   none. A row that leaves before then is not sent, and starts again the next
   time it comes into view. Time in a tab nobody is looking at does not
   count. Rows that came into view in the same moment go in one call. A
   browser that cannot say what is on screen sends nothing.

     StudentSeenWatch.watch({ attr, max, live, ready, unseen, mark, send })
       attr     the attribute each row to watch carries, holding its id
       live()   the screen it was started for is still showing
       ready()  it may still tell the server (the same page, signed in)
       unseen() the ids that may still be told, in the page's order
       mark(ids) the ids are being told: they are no longer unseen
       send(ids) tells the server; returns a promise
       max      the most ids in one call
     Returns { stop, lookAgain, tell }, or null when there is nothing to
     watch. lookAgain(): the tab was hidden or shown, so a row's time on
     screen starts over. tell(): the rows that have been on screen long
     enough are told now. */
/** @type {any} */ (window).StudentSeenWatch = (function () {
  'use strict';

  var SEEN_AFTER_MS = 600;
  // Rows that came into view in the same moment go in the same call.
  var SEEN_SLACK_MS = 150;

  function tabHidden() {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  /** @param {any} o */
  function watch(o) {
    if (typeof IntersectionObserver !== 'function' || typeof document === 'undefined') return null;
    var rows = document.querySelectorAll('[' + o.attr + ']');
    if (!rows.length) return null;
    /** @type {{ observer: any, since: Record<string, number>, timer: any, stopped: boolean }} */
    var w = { observer: null, since: {}, timer: 0, stopped: false };
    // The header stays over the top of the list: a row under it is not on screen.
    // Heights as drawn on the screen (getBoundingClientRect), so a Text Size's zoom is counted.
    var head = document.querySelector('.sp-head');
    var headRect = head && typeof head.getBoundingClientRect === 'function' ? head.getBoundingClientRect() : null;
    var under = (headRect && headRect.height) || 0;
    // On a phone the tabs sit over the bottom of the list: a row under them is not on screen either.
    var bar = document.querySelector('.sp-tabs-bottom');
    var rect = bar && typeof bar.getBoundingClientRect === 'function' ? bar.getBoundingClientRect() : null;
    var over =
      rect && typeof window.innerHeight === 'number' && rect.top > window.innerHeight / 2 ? rect.height || 0 : 0;

    /* Rows are in view. When the first of them has been there long enough,
       the ones that have are told to the server. */
    function shown() {
      if (w.stopped || !o.live()) return;
      if (w.timer) clearTimeout(w.timer);
      w.timer = 0;
      if (tabHidden()) return;
      var first = Infinity;
      o.unseen().forEach(function (/** @type {string} */ id) {
        if (id in w.since) first = Math.min(first, w.since[id]);
      });
      if (first === Infinity) return;
      w.timer = setTimeout(tell, Math.max(first + SEEN_AFTER_MS + SEEN_SLACK_MS - Date.now(), 0));
    }

    /* One call for every row that is still in view and has been for long
       enough. A row is marked as told when it is sent, so it is sent once
       whatever the answer. */
    function tell() {
      if (w.stopped) return Promise.resolve();
      if (w.timer) clearTimeout(w.timer);
      w.timer = 0;
      if (!o.ready() || tabHidden()) return Promise.resolve();
      var now = Date.now();
      var ids = o
        .unseen()
        .filter(function (/** @type {string} */ id) {
          return id in w.since && now - w.since[id] >= SEEN_AFTER_MS;
        })
        .slice(0, o.max);
      if (ids.length) o.mark(ids);
      // Rows still in view that have not been there long enough yet.
      shown();
      if (!ids.length) return Promise.resolve();
      return o.send(ids);
    }

    w.observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (/** @type {any} */ entry) {
          var id = entry.target.getAttribute(o.attr);
          if (!entry.isIntersecting) delete w.since[id];
          else if (!(id in w.since)) w.since[id] = Date.now();
        });
        if (!w.stopped) shown();
      },
      { rootMargin: '-' + under + 'px 0px -' + over + 'px 0px', threshold: 0.6 },
    );
    Array.prototype.forEach.call(rows, function (row) {
      w.observer.observe(row);
    });

    return {
      stop: function () {
        if (w.stopped) return;
        w.stopped = true;
        if (w.timer) clearTimeout(w.timer);
        if (w.observer) w.observer.disconnect();
      },
      lookAgain: function () {
        if (w.stopped) return;
        var now = Date.now();
        Object.keys(w.since).forEach(function (id) {
          w.since[id] = now;
        });
        shown();
      },
      tell: tell,
    };
  }

  return { watch: watch, SEEN_AFTER_MS: SEEN_AFTER_MS };
})();
