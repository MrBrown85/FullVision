// @ts-check
/* photo-expiry.js — A warning before the year runs out (docs/DECISIONS.md,
   "Photos stay with the class", the Nov 17 addition).

   The nightly job deletes a class's photos once the class has gone 365 days
   without a teacher opening it (migrations/2026111704). In the 30 days
   before that, the Dashboard and the phone's Students screen show one quiet
   line per such class, at most three, then "And N more classes.":

     Photos in Science 8 will be deleted on Dec 17 because the class hasn't
     been opened for a year. Open it to keep them.   [Open Class]

   Opening the class stamps it (noteClassOpenedSoon), which clears its line;
   there is no Dismiss. The date is the first nightly run (10:27 UTC) after
   365 days from the last open, the same 365 days as the server's
   _photo_keep_class, shown in the teacher's own time zone.

   Where the classes come from: list_course_photo_expiry
   (migrations/2026111705), asked once per page load once the teacher is
   signed in, never blocking start-up. It answers only for the teacher's own
   classes with photos unopened for 300 days or more, so it is nearly always
   empty. A failure, or a server without the function, is no classes: no
   line, nothing on the sync dot. Demo Mode asks no server; a test can seed
   classes under localStorage 'fv-demo-photo-expiry' (the demo has none, so
   the line never shows there unless seeded).

     mount(where)   the box to draw, filled now and again when the list
                    arrives or a class is opened; where is 'dash' or 'phone'
     lines(now)     the classes to warn about, soonest first
     opened(cid)    a class was opened: its line goes */
/** @type {any} */ (window).PhotoExpiry = (function () {
  'use strict';

  var DAY = 86400000;
  var YEAR = 365 * DAY; // _photo_keep_class: interval '365 days'
  var WARN = 30 * DAY;
  var MAX = 3;
  var SEED_KEY = 'fv-demo-photo-expiry';

  /** @type {{ course_id: string, last_opened_at: string, photos: number }[] | null} */
  var _rows = null; // once known
  var _asked = false;
  /** @type {Record<string, boolean>} */
  var _openedHere = {};

  function _demo() {
    return typeof _isDemoSession === 'function' && _isDemoSession();
  }

  function _seed() {
    try {
      var rows = JSON.parse(localStorage.getItem(SEED_KEY) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      return [];
    }
  }

  // Asks once per page load, as soon as the teacher is signed in.
  function load() {
    if (_asked) return;
    if (_demo()) {
      _asked = true;
      _rows = _seed();
      return;
    }
    if (typeof _useSupabase === 'undefined' || !_useSupabase) return;
    if (typeof getSupabase !== 'function' || !getSupabase() || typeof _callRpcWithAuthGuard !== 'function') return;
    _asked = true;
    Promise.resolve()
      .then(function () {
        // Untyped: types/database.d.ts has the function once 2026111705 is applied.
        return /** @type {any} */ (_callRpcWithAuthGuard)('list_course_photo_expiry', {});
      })
      .then(
        function (res) {
          _rows = res && !res.error && Array.isArray(res.data) ? res.data : [];
        },
        function () {
          _rows = [];
        },
      )
      .then(_refresh);
  }

  /* The night the photos go: the first nightly run (10:27 UTC) after 365
     days from the last open, and never one already past. */
  function deletionAt(lastOpened, now) {
    var due = Date.parse(lastOpened) + YEAR;
    if (isNaN(due)) return null;
    var d = new Date(due);
    var run = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 10, 27);
    if (run <= due) run += DAY;
    while (run <= now) run += DAY;
    return new Date(run);
  }

  function _localDay(d) {
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  }

  function _name(cid) {
    var c = typeof COURSES !== 'undefined' && COURSES ? COURSES[cid] : null;
    return c && c.name ? c.name : '';
  }

  function lines(now) {
    now = now == null ? Date.now() : now;
    var active = typeof getActiveCourse === 'function' ? getActiveCourse() : null;
    return (_rows || [])
      .filter(function (r) {
        var cid = r && r.course_id;
        if (!cid || _openedHere[cid] || cid === active || !_name(cid) || !(r.photos > 0)) return false;
        var due = Date.parse(r.last_opened_at) + YEAR;
        return !isNaN(due) && now >= due - WARN;
      })
      .map(function (r) {
        var at = /** @type {Date} */ (deletionAt(r.last_opened_at, now));
        var day = typeof formatShortDate === 'function' ? formatShortDate(_localDay(at)) : _localDay(at);
        return {
          cid: r.course_id,
          at: at,
          text:
            'Photos in ' +
            _name(r.course_id) +
            ' will be deleted on ' +
            day +
            " because the class hasn't been opened for a year. Open it to keep them.",
        };
      })
      .sort(function (a, b) {
        return Number(a.at) - Number(b.at) || (a.text < b.text ? -1 : 1);
      });
  }

  // The lines as HTML; '' when there are none.
  function html(where, now) {
    var all = lines(now);
    if (!all.length) return '';
    var phone = where === 'phone';
    var out = all.slice(0, MAX).map(function (l) {
      return (
        '<div class="photo-expiry-line" data-cid="' +
        esc(l.cid) +
        '"><p class="photo-expiry-text">' +
        esc(l.text) +
        '</p><button type="button" class="' +
        (phone ? 'm-photo-expiry-btn' : 'btn btn-secondary') +
        '" data-action="' +
        (phone ? 'm-photo-expiry-open' : 'photoExpiryOpen') +
        '" data-cid="' +
        esc(l.cid) +
        '">Open Class</button></div>'
      );
    });
    var more = all.length - MAX;
    if (more > 0)
      out.push('<p class="photo-expiry-more">And ' + more + ' more ' + (more === 1 ? 'class' : 'classes') + '.</p>');
    return out.join('');
  }

  function mount(where) {
    load();
    where = where === 'phone' ? 'phone' : 'dash';
    return '<div class="photo-expiry" data-where="' + where + '">' + html(where) + '</div>';
  }

  function _refresh() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.photo-expiry[data-where]').forEach(function (box) {
      // html-safe: html() escapes every name, id and date through esc.
      box.innerHTML = html(/** @type {HTMLElement} */ (box).dataset.where);
    });
  }

  function opened(cid) {
    if (!cid || _openedHere[cid]) return;
    _openedHere[cid] = true;
    if (_demo()) {
      try {
        var left = _seed().filter(function (r) {
          return r && r.course_id !== cid;
        });
        localStorage.setItem(SEED_KEY, JSON.stringify(left));
      } catch (e) {
        /* storage blocked: this visit forgets it */
      }
    }
    _refresh();
  }

  // For tests: forget what was asked and opened.
  function _reset(rows) {
    _rows = rows || null;
    _asked = !!rows;
    _openedHere = {};
  }

  return {
    SEED_KEY: SEED_KEY,
    load: load,
    deletionAt: deletionAt,
    lines: lines,
    html: html,
    mount: mount,
    opened: opened,
    _reset: _reset,
  };
})();
